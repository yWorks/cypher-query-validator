import {
  NodeLabelsContext,
  NotLabelTermContext,
  NotRelationShipTypeTermContext,
  OrLabelTermContext,
  OrRelationShipTypeTermContext,
  SymbolicNameContext,
  WildcardLabelContext,
} from "./antlr/CypherParser";
import { ParserRuleContext, ParseTreeWalker } from "antlr4";
import CypherListener from "./antlr/CypherListener";
import { NameRetriever } from "./NameRetriever";

export type Validator = (labelOrType: string) => boolean;

function labeledValidator(validator: Validator, label: string): Validator {
  validator.toString = () => label;
  return validator;
}

export const ANY_LABEL_VALIDATOR: Validator = labeledValidator(
  () => true,
  "ANY",
);
ANY_LABEL_VALIDATOR.toString = () => "ANY";

class ValidatorCreatorBase extends CypherListener {
  private validators: Validator[] = [];

  protected andValidator() {
    const oldValidations = this.validators;
    if (oldValidations.length > 1) {
      // If there is an *and* label, we don't have that in the schema, so we accept it if one of them matches...

      const andValidator: Validator = (label) =>
        oldValidations.every((validator) => validator(label));
      const orValidator: Validator = (label) =>
        oldValidations.some((validator) => validator(label));

      const challengeQuirk = true;

      this.validators = [
        labeledValidator(
          challengeQuirk ? orValidator : andValidator,
          oldValidations.map((v) => v.toString()).join("&"),
        ),
      ];
    }
  }

  protected orValidator() {
    const oldValidations = this.validators;
    if (oldValidations.length > 1) {
      const orValidator: Validator = (label) =>
        oldValidations.some((validator) => validator(label));
      this.validators = [
        labeledValidator(
          orValidator,
          oldValidations.map((v) => v.toString()).join("|"),
        ),
      ];
    }
  }

  protected wildCardValidator() {
    this.validators.push(ANY_LABEL_VALIDATOR);
  }

  protected inverseValidator() {
    const validator = this.validators[0];
    this.validators[0] = labeledValidator(
      (label) => !validator(label),
      "!" + validator.toString(),
    );
  }

  exitSymbolicName: (ctx: SymbolicNameContext) => void = (ctx) => {
    const name = NameRetriever.getName(ctx);
    if (name) {
      this.validators.push(
        labeledValidator(
          (label) => label.toLowerCase() === name.toLowerCase(),
          name,
        ),
      );
    }
  };

  get validator(): Validator {
    return this.validators[0] ?? ANY_LABEL_VALIDATOR;
  }
}

export class NodeLabelValidator extends ValidatorCreatorBase {
  exitOrLabelTerm: (ctx: OrLabelTermContext) => void = () => {
    this.orValidator();
  };

  exitWildcardLabel: (ctx: WildcardLabelContext) => void = () => {
    this.wildCardValidator();
  };

  exitNotLabelTerm: (ctx: NotLabelTermContext) => void = () => {
    this.inverseValidator();
  };

  exitNodeLabels: (ctx: NodeLabelsContext) => void = () => {
    this.andValidator();
  };

  static getValidator(root?: ParserRuleContext): Validator {
    if (root) {
      const validatorWalker = new NodeLabelValidator();
      ParseTreeWalker.DEFAULT.walk(validatorWalker, root);
      return validatorWalker.validator;
    } else {
      return ANY_LABEL_VALIDATOR;
    }
  }
}

export class RelationshipTypeValidator extends ValidatorCreatorBase {
  exitOrRelationShipTypeTerm: (ctx: OrRelationShipTypeTermContext) => void =
    () => {
      this.orValidator();
    };

  exitWildcardLabel: (ctx: WildcardLabelContext) => void = () => {
    this.wildCardValidator();
  };

  exitNotRelationShipTypeTerm: (ctx: NotRelationShipTypeTermContext) => void =
    () => {
      this.inverseValidator();
    };

  exitNodeLabels: (ctx: NodeLabelsContext) => void = () => {
    this.andValidator();
  };

  static getValidator(root?: ParserRuleContext): Validator {
    if (root) {
      const validatorWalker = new RelationshipTypeValidator();
      ParseTreeWalker.DEFAULT.walk(validatorWalker, root);
      return validatorWalker.validator;
    } else {
      return ANY_LABEL_VALIDATOR;
    }
  }
}
