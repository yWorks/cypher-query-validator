import CypherParser, {
  AsMappingContext,
  CypherContext,
  NodePatternContext,
  PatternElementContext,
  RelationshipPatternContext,
  RelationshipsPatternContext,
  ReturnItemContext,
  ReturnItemsContext,
  SubqueryClauseContext,
  VariableContext,
  WithClauseContext,
} from "./antlr/CypherParser";
import CypherLexer from "./antlr/CypherLexer";
import {CharStream, CommonTokenStream, ParseTreeVisitor, ParseTreeWalker} from "antlr4";
import CypherListener from "./antlr/CypherListener";
import { NameRetriever } from "./NameRetriever";
import {
  ANY_LABEL_VALIDATOR,
  LabelValidator,
  NodeLabelValidator,
  RelationShipTypeValidator,
} from "./labelvalidators";

type NodeChainElement = {
  type: "node";
  labels: LabelValidator;
};

type RelChainElement = {
  type: "relation";
  relType: "LEFT" | "RIGHT" | "UNDIRECTED";
  types: LabelValidator;
  ctx: RelationshipPatternContext;
};

type Binding = { name: string; types: LabelValidator };
type Scope = { bindings: Binding[] };

class BindingCollector extends CypherListener {
  constructor(private resolve: (variable: string) => LabelValidator, private oldBindings: Binding[], private bindings: Binding[]) {
    super();
  }

  enterAsMapping: (ctx: AsMappingContext) => void = (ctx)=> {
    const varName = NameRetriever.getName(ctx.variable())
    if (ctx.expression().ruleIndex === CypherParser.RULE_expression){
      const expVar = NameRetriever.getName(ctx.expression())
      if (expVar){
        this.bindings.push({name: varName, types: this.resolve(expVar)})
      }
    }
  }

  enterReturnItems: (ctx: ReturnItemsContext) => void = (ctx) => {
    if (ctx.getText().charAt(0) === '*') {
      this.bindings.push(...this.oldBindings)
    }
  }

  enterReturnItem: (ctx: ReturnItemContext) => void = (ctx) => {
    if (!ctx.asMapping()){
      const name = NameRetriever.getName(ctx)
      if (name){
        this.bindings.push({name, types: this.resolve(name)})
      }
    }
  }
  exitReturnItem: (ctx: ReturnItemContext) => void = (ctx) => {

  }

  static getBindings(resolve: (variable: string) => LabelValidator, oldBindings:Binding[], ctx: WithClauseContext) {
    if (ctx) {
      const bindings: Binding[] = []
      const nameRetriever = new BindingCollector(resolve, oldBindings, bindings);
      ParseTreeWalker.DEFAULT.walk(nameRetriever, ctx);
      return bindings
    } else {
      return undefined;
    }
  }
}

class PatternFixer extends CypherListener {
  private chains: (NodeChainElement | RelChainElement)[][] = [];
  public invalid = false;
  public diagnostics: string[] = [];
  private scopes: Scope[] = [];

  constructor(
    private schema: RelationShipTuple[],
    public cypher: string,
  ) {
    super();
  }

  enterCypher: (ctx: CypherContext) => void = () => this.startNewScope(false);
  exitCypher: (ctx: CypherContext) => void = () => this.exitScope();

  enterPatternElement: (ctx: PatternElementContext) => void = () =>
    this.startNewPattern();
  enterRelationshipsPattern: (ctx: RelationshipsPatternContext) => void = () =>
    this.startNewPattern();

  exitRelationshipsPattern: (ctx: RelationshipsPatternContext) => void = () =>
    this.fixPatterns();
  exitPatternElement: (ctx: PatternElementContext) => void = () =>
    this.fixPatterns();

  startNewPattern() {
    this.chains.push([]);
  }

  startNewScope(inherit:boolean = true) {
    this.scopes.push({ bindings: inherit ? [...this.scopes.at(-1).bindings] : []});
  }

  exitScope() {
    this.scopes.pop();
  }

  registerVariable(name: string, types: LabelValidator) {
    const scope = this.scopes.at(-1)!;
    scope.bindings.push({ name, types });
  }

  resolve(variable: string): LabelValidator {
    const scope = this.scopes.at(-1);
    let binding = scope.bindings.find((b) => b.name === variable);
    if (binding && binding.types) {
      return binding.types;
    }
    // new variable - matches anything
    return ANY_LABEL_VALIDATOR;
  }

  notFound(message?: string): void {
    this.invalid = true;
    if (message) {
      this.diagnostics.push("Not Found " + message);
    }
  }

  enterSubqueryClause: (ctx: SubqueryClauseContext) => void = () => this.startNewScope()
  exitSubqueryClause: (ctx: SubqueryClauseContext) => void = () => this.exitScope()


  fixPatterns() {
    const chain = this.chains.pop()!;

    function schemaFits(
      schema: RelationShipTuple,
      src: NodeChainElement,
      relation: RelChainElement,
      target: NodeChainElement,
    ) {
      return (
        src.labels(schema.sourceLabel) &&
        target.labels(schema.targetLabel) &&
        relation.types(schema.relationShipType)
      );
    }

    // we start from 1
    for (let i = 1; i < chain.length; i++) {
      const chainElement = chain[i];
      if (chainElement.type === "relation") {
        const src = chain[i - 1] as NodeChainElement;
        const relation = chainElement;
        const target = chain[i + 1] as NodeChainElement;
        let rightExists = this.schema.find((value) =>
          schemaFits(value, src, relation, target),
        );
        let leftExists = this.schema.find((value) =>
          schemaFits(value, target, relation, src),
        );
        // console.log(`(:${src.labels})-[:${relation.types}]-(:${target.labels})`)
        if (relation.relType === "RIGHT") {
          if (!rightExists) {
            if (leftExists) {
              const from = relation.ctx.relationshipPatternStart().start.start;
              const to = relation.ctx.relationshipPatternEnd().start.start;
              this.cypher =
                this.cypher.substring(0, from) +
                "<" +
                this.cypher.substring(from, to + 1) +
                "" +
                this.cypher.substring(to + 2);
            } else {
              this.notFound(
                `(:${src.labels})-[:${relation.types}]->(:${target.labels})`,
              );
            }
          }
        } else if (relation.relType === "LEFT") {
          if (!leftExists) {
            if (rightExists) {
              const from = relation.ctx.relationshipPatternStart().start.start;
              const to = relation.ctx.relationshipPatternEnd().start.start;
              this.cypher =
                this.cypher.substring(0, from) +
                "" +
                this.cypher.substring(from + 1, to + 1) +
                ">" +
                this.cypher.substring(to + 1);
            } else {
              this.notFound(
                `(:${src.labels})<-[:${relation.types}]-(:${target.labels})`,
              );
            }
          }
        } else if (relation.relType === "UNDIRECTED") {
          if (!(rightExists || leftExists)) {
            this.notFound(
              `(:${src.labels})-[:${relation.types}]-(:${target.labels})`,
            );
          }
        }
      }
    }
  }


  enterWithClause: (ctx: WithClauseContext) => void = (ctx)=> {
    const bindings = BindingCollector.getBindings(variable => this.resolve(variable), this.scopes.at(-1).bindings, ctx)
    this.startNewScope(false)
    bindings.forEach(b => this.registerVariable(b.name, b.types))
  }
  exitWithClause: (ctx: WithClauseContext) => void = (ctx)=> {
  }

  enterNodePattern: (ctx: NodePatternContext) => void = (ctx) => {
    const currentChain = this.getCurrentChain();

    let nodeLabels = this.getNodeLabels(ctx);

    let name: string | undefined = undefined;
    if (ctx.variable()) {
      name = NameRetriever.getName(ctx.variable());
    }
    if (name && nodeLabels.length > 0) {
      this.registerVariable(name, nodeLabels);
    }
    currentChain.push({
      type: "node",
      labels: nodeLabels,
    });
  };

  private getNodeLabels(ctx: NodePatternContext): LabelValidator {
    const name = NameRetriever.getName(ctx.variable());
    if (!ctx.nodeLabels() && name) {
      return this.resolve(name);
    }

    return NodeLabelValidator.getValidator(ctx.nodeLabels());
  }

  enterRelationshipPattern: (ctx: RelationshipPatternContext) => void = (
    ctx,
  ) => {
    const relType = ctx.relationshipPatternStart().leftArrowHead()
      ? "LEFT"
      : ctx.relationshipPatternEnd().rightArrowHead()
      ? "RIGHT"
      : "UNDIRECTED";

    const relationShipTypes = this.getRelationShipTypes(ctx);

    let name: string | undefined = undefined;
    if (ctx.relationshipDetail()?.variable()) {
      name = NameRetriever.getName(ctx.relationshipDetail()?.variable());
    }
    if (name && relationShipTypes.length > 0) {
      this.registerVariable(name, relationShipTypes);
    }

    const currentChain = this.getCurrentChain();
    currentChain.push({
      type: "relation",
      types: relationShipTypes,
      relType,
      ctx,
    });
  };

  private getCurrentChain() {
    return this.chains.at(-1)!;
  }

  private getRelationShipTypes(
    ctx: RelationshipPatternContext,
  ): LabelValidator {
    const name = NameRetriever.getName(ctx.relationshipDetail()?.variable());
    if (name && !ctx.relationshipDetail()?.relationshipTypes()) {
      return this.resolve(name);
    }
    // special rule: ignore variable length patterns and stop validation!?
    if (ctx.relationshipDetail()?.rangeLiteral()) {
      return ANY_LABEL_VALIDATOR;
    }
    if (ctx.relationshipDetail()?.relationshipTypes()) {
      return RelationShipTypeValidator.getValidator(
        ctx.relationshipDetail().relationshipTypes(),
      );
    } else {
      return ANY_LABEL_VALIDATOR;
    }
  }
}

type RelationShipTuple = {
  sourceLabel: string;
  relationShipType: string;
  targetLabel: string;
};

export function validate(cypher: string, schema: RelationShipTuple[]) {
  const stream = new CharStream(cypher);

  const lexer = new CypherLexer(stream);
  const tokens = new CommonTokenStream(lexer);
  const parser = new CypherParser(tokens);

  let tree: CypherContext;
  tree = parser.cypher();
  if (parser.syntaxErrorsCount > 0) {
    return "";
  }

  const builder = new PatternFixer(schema, cypher);
  ParseTreeWalker.DEFAULT.walk(builder, tree);

  if (builder.diagnostics.length > 0) {
    console.log(builder.diagnostics.join("\n"));
  }

  return builder.invalid ? "" : builder.cypher;
}
