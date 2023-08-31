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

export type LabelValidator = (label: string) => boolean;

function labeledValidator(
  validator: LabelValidator,
  label: string,
): LabelValidator {
  validator.toString = () => label;
  return validator;
}

export const ANY_LABEL_VALIDATOR: LabelValidator = labeledValidator(
  () => true,
  "ANY",
);
ANY_LABEL_VALIDATOR.toString = () => "ANY";

class TermValidatorBase extends CypherListener {
  private validations: LabelValidator[] = [];

  protected andValidator() {
    const oldValidations = this.validations;
    if (oldValidations.length > 1) {
      // If there is an *and* label, we don't have that in the schema, so we accept it if one of them matches...

      const andValidator: LabelValidator = (label) =>
        oldValidations.every((validator) => validator(label));
      const orValidator: LabelValidator = (label) =>
        oldValidations.some((validator) => validator(label));

      const challengeQuirk = true;

      this.validations = [
        labeledValidator(
          challengeQuirk ? orValidator : andValidator,
          oldValidations.map((v) => v.toString()).join("&"),
        ),
      ];
    }
  }

  protected orValidator() {
    const oldValidations = this.validations;
    if (oldValidations.length > 1) {
      const orValidator: LabelValidator = (label) =>
        oldValidations.some((validator) => validator(label));
      this.validations = [
        labeledValidator(
          orValidator,
          oldValidations.map((v) => v.toString()).join("|"),
        ),
      ];
    }
  }

  protected wildCardValidator() {
    this.validations.push(ANY_LABEL_VALIDATOR);
  }

  protected inverseValidator() {
    const validator = this.validations[0];
    this.validations[0] = labeledValidator(
      (label) => !validator(label),
      "!" + validator.toString(),
    );
  }

  exitSymbolicName: (ctx: SymbolicNameContext) => void = (ctx) => {
    const name = NameRetriever.getName(ctx);
    if (name) {
      this.validations.push(
        labeledValidator(
          (label) => label.toLowerCase() === name.toLowerCase(),
          name,
        ),
      );
    }
  };

  get validator(): LabelValidator {
    return this.validations[0] ?? ANY_LABEL_VALIDATOR;
  }
}

export class NodeLabelValidator extends TermValidatorBase {
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

  static getValidator(root?: ParserRuleContext): LabelValidator {
    if (root) {
      const validatorWalker = new NodeLabelValidator();
      ParseTreeWalker.DEFAULT.walk(validatorWalker, root);
      return validatorWalker.validator;
    } else {
      return ANY_LABEL_VALIDATOR;
    }
  }
}

export class RelationShipTypeValidator extends TermValidatorBase {
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

  static getValidator(root?: ParserRuleContext): LabelValidator {
    if (root) {
      const validatorWalker = new NodeLabelValidator();
      ParseTreeWalker.DEFAULT.walk(validatorWalker, root);
      return validatorWalker.validator;
    } else {
      return ANY_LABEL_VALIDATOR;
    }
  }
}
