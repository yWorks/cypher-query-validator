

import tests from './tests.json'
import {validate} from "../src/validate";
import {expect} from 'chai'

tests.forEach((testCase, i) => {
    const tuples : {sourceLabel:string, relationShipType:string, targetLabel:string}[] = []

    const schema = testCase.schema.matchAll(/\((\w+),\s*(\w+),\s*(\w+)\s*\)/g)
    for (const tuple of schema) {
        tuples.push({sourceLabel:tuple[1], relationShipType:tuple[2], targetLabel:tuple[3]})
    }

    const validated = validate(testCase.statement, tuples)

    try {
        expect(validated).to.equal(testCase.correct_query)
    } catch (e){
        console.log({index: i, input: testCase.statement, validated, expected:testCase.correct_query, schema: JSON.stringify(tuples)})
    }
})

