import CypherParser, {
    CypherContext,
    NodePatternContext,
    PatternElementContext,
    RelationshipPatternContext, RelationshipsPatternContext, SymbolicNameContext
} from "./antlr/CypherParser";
import CypherLexer from "./antlr/CypherLexer";
import {CharStream, CommonTokenStream, ParserRuleContext, ParseTreeWalker} from 'antlr4'
import CypherListener from "./antlr/CypherListener";

type AstNode = { type: string, children: AstNode[] }

type NodeChainElement = {
    "type": "node",
    "labels": (string | undefined)[]
}
type RelChainElement = {
    "type": "relation",
    "relType": "LEFT" | "RIGHT" | "UNDIRECTED"
    "types": string[] | undefined
    "ctx": RelationshipPatternContext
}

class NameRetriever extends CypherListener {

    public name: string = ""

    enterSymbolicName: (ctx: SymbolicNameContext) => void = (ctx) => {
        if (ctx.EscapedSymbolicName()) {
            let escapedValue = ctx.EscapedSymbolicName().getText();
            this.name = escapedValue.substring(1, escapedValue.length - 1).replace(/''/g, "'")
        } else {
            this.name = ctx.getText()
        }
    }

    static getName(root?: ParserRuleContext): string | undefined {
        if (root) {
            const nameRetriever = new NameRetriever()
            ParseTreeWalker.DEFAULT.walk(nameRetriever, root)
            return nameRetriever.name
        } else {
            return undefined
        }
    }
}

type Binding = { name: string, types: string[] }
type Scope = { bindings: Binding[] }

class ASTBuilder extends CypherListener {

    private chains: (NodeChainElement | RelChainElement)[][] = []
    public invalid = false
    private scopes: Scope[] = []

    constructor(private schema: RelationShipTuple[], public cypher: string) {
        super();

    }


    enterCypher: (ctx: CypherContext) => void = () => this.startNewScope()
    exitCypher: (ctx: CypherContext) => void = () => this.exitScope()

    enterPatternElement: (ctx: PatternElementContext) => void = () => this.startNewPattern()
    enterRelationshipsPattern: (ctx: RelationshipsPatternContext) => void = () => this.startNewPattern()


    exitRelationshipsPattern: (ctx: RelationshipsPatternContext) => void = () => this.fixPatterns()
    exitPatternElement: (ctx: PatternElementContext) => void = () => this.fixPatterns()

    startNewPattern() {
        this.chains.push([])
    }

    startNewScope() {
        this.scopes.push({bindings: []})
    }

    exitScope() {
        this.scopes.pop()
    }

    registerVariable(name: string, types:string[]){
        const scope = this.scopes.at(-1)!
        scope.bindings.push({name, types})
    }

    resolve(variable: string): string[] {
        for (let i = this.scopes.length - 1; i >= 0; i--) {
            const scope = this.scopes[i];
            let binding = scope.bindings.find(b => b.name === variable);
            if (binding && binding.types) {
                return binding.types
            }
        }
        return []
    }

    notFound(): void {
        this.invalid = true
    }

    fixPatterns() {
        const chain = this.chains.pop()!

        function matchesLabel(label: string | undefined, labels: (string | undefined)[]) {
            if (labels?.includes(undefined) || labels.length === 0) return true
            if (typeof label === "undefined" || label === '*') return true
            if (labels.includes(label)) return true
            return false
        }

        //console.log("found")

        function tupleMatches(schema: RelationShipTuple, src: NodeChainElement, relation: RelChainElement, target: NodeChainElement) {
            return matchesLabel(schema.sourceLabel, src.labels) && matchesLabel(schema.targetLabel, target.labels) && matchesLabel(schema.relationShipType, relation.types ?? []);
        }

        // we start from 1
        for (let i = 1; i < chain.length; i++) {
            const chainElement = chain[i];
            if (chainElement.type === "relation") {
                const src = chain[i - 1] as NodeChainElement
                const relation = chainElement
                const target = chain[i + 1] as NodeChainElement
                let rightExists = this.schema.find(value => tupleMatches(value, src, relation, target));
                let leftExists = this.schema.find(value => tupleMatches(value, target, relation, src));
                if (relation.relType === "RIGHT") {
                    if (!rightExists) {
                        if (leftExists) {
                            const from = relation.ctx.relationshipPatternStart().start.start
                            const to = relation.ctx.relationshipPatternEnd().start.start
                            this.cypher = this.cypher.substring(0, from) + "<" + this.cypher.substring(from, to + 1) + "" + this.cypher.substring(to + 2)
                        } else {
                            this.notFound()
                            console.log(`not found (:${JSON.stringify(src.labels)})-[${relation.relType}:${JSON.stringify(relation.types)}]-(:${JSON.stringify(target.labels)})`)
                        }
                    }
                } else if (relation.relType === "LEFT") {
                    if (!leftExists) {
                        if (rightExists) {
                            const from = relation.ctx.relationshipPatternStart().start.start
                            const to = relation.ctx.relationshipPatternEnd().start.start
                            this.cypher = this.cypher.substring(0, from) + "" + this.cypher.substring(from + 1, to + 1) + ">" + this.cypher.substring(to + 1)
                        } else {
                            this.notFound()
                            console.log(`not found (:${JSON.stringify(src.labels)})-[${relation.relType}:${JSON.stringify(relation.types)}]-(:${JSON.stringify(target.labels)})`)
                        }
                    }
                } else if (relation.relType === "UNDIRECTED") {
                    if (!(rightExists || leftExists)) {
                        this.notFound()
                        console.log(`not found (:${JSON.stringify(src.labels)})-[${relation.relType}:${JSON.stringify(relation.types)}]-(:${JSON.stringify(target.labels)})`)
                    }
                }
            }
        }
    }


    enterNodePattern: (ctx: NodePatternContext) => void = ctx => {
        const currentChain = this.chains.at(-1)!;

        let nodeLabels = this.getNodeLabels(ctx);

        let name: string | undefined = undefined
        if (ctx.variable()){
            name = NameRetriever.getName(ctx.variable())
        }
        if (name && nodeLabels.length > 0){
            this.registerVariable(name, nodeLabels)
        }
        currentChain.push({
            type: "node",
            labels: nodeLabels
        })
    };

    private getNodeLabels(ctx: NodePatternContext): string[] {
        const name = NameRetriever.getName(ctx.variable())
        if (!ctx.nodeLabels() && name) {
            return this.resolve(name)
        }
        return (ctx.nodeLabels()?.nodeLabel_list().map(item => NameRetriever.getName(item.labelName())).filter(name => typeof name !== "undefined") as (string[] | undefined)) ?? [];
    }

    enterRelationshipPattern: (ctx: RelationshipPatternContext) => void = ctx => {
        const relType = ctx.relationshipPatternStart().leftArrowHead() ? "LEFT" : ctx.relationshipPatternEnd().rightArrowHead() ? "RIGHT" : "UNDIRECTED"

        let relationShipTypes = this.getRelationShipTypes(ctx);

        let name: string | undefined = undefined
        if (ctx.relationshipDetail()?.variable()){
            name = NameRetriever.getName(ctx.relationshipDetail()?.variable())
        }
        if (name && relationShipTypes.length > 0){
            this.registerVariable(name, relationShipTypes)
        }


        const currentChain = this.chains.at(-1)!;
        currentChain.push({
            type: "relation",
            types: relationShipTypes,
            relType,
            ctx
        })
    }

    private getRelationShipTypes(ctx: RelationshipPatternContext): string[] {
        const name = NameRetriever.getName(ctx.relationshipDetail()?.variable())
        if (name && !ctx.relationshipDetail()?.relationshipTypes()) {
            return this.resolve(name)
        }
        const types: string[] = []
        if (ctx.relationshipDetail()?.relationshipTypes()?.relationshipType()) {
            let name = NameRetriever.getName(ctx.relationshipDetail()?.relationshipTypes()?.relationshipType().relTypeName());
            if (name)
                types.push(name)
        }
        if (ctx.relationshipDetail()?.relationshipTypes()?.relationshipTypeOptionalColon_list()) {
            ctx.relationshipDetail().relationshipTypes().relationshipTypeOptionalColon_list().map(entry =>
                NameRetriever.getName(entry.relTypeName())).forEach(name => {
                    if (name)
                        types.push(name)
            })
        }
        return types;
    }
}

type RelationShipTuple = { sourceLabel: string, relationShipType: string, targetLabel: string }

export function validate(cypher: string, schema: RelationShipTuple[]) {
    const stream = new CharStream(cypher)

    const lexer = new CypherLexer(stream)
    const tokens = new CommonTokenStream(lexer)
    const parser = new CypherParser(tokens)

    const lenient = false
    let errored = false
    if (!lenient) {
    }

    let tree: CypherContext;
//    try {
    tree = parser.cypher();
    if (parser.syntaxErrorsCount > 0) {
        return ''
    }
    if (errored) {
        return ''
    }
    /*  } catch (e) {
          if (!lenient) {
              return ''
          } else {
              throw e
          }
      }*/


    const builder = new ASTBuilder(schema, cypher)
    ParseTreeWalker.DEFAULT.walk(builder, tree)


    return builder.invalid ? '' : builder.cypher
}

