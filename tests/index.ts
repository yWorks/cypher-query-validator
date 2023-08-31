import tests from "./tests.json";
import { validate } from "../src/validate";
import { expect } from "chai";

describe("Tests", () => {
  tests.forEach((testCase) => {
    const tuples: {
      sourceLabel: string;
      relationShipType: string;
      targetLabel: string;
    }[] = [];

    const schema = testCase.schema.matchAll(/\((\w+),\s*(\w+),\s*(\w+)\s*\)/g);
    for (const tuple of schema) {
      tuples.push({
        sourceLabel: tuple[1],
        relationShipType: tuple[2],
        targetLabel: tuple[3],
      });
    }

    if (testCase.correct_query === "") {
      it(`should fail to convert '${testCase.statement}'`, () => {
        const validated = validate(testCase.statement, tuples);
        expect(validated).to.be.empty;
      });
    } else {
      it(`should convert '${testCase.statement}'`, () => {
        const validated = validate(testCase.statement, tuples);
        expect(validated).to.equal(testCase.correct_query);
      });
    }
  });
});
