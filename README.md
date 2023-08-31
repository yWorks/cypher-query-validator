# Cypher-Validator

This Typescript package can be used to validate cypher queries. With the help of a simple schema, the validator will check and correct the directions of relationship patterns. 

There is only one public API and that is the "validate" method:

```
type RelationShipTuple = {
  sourceLabel: string;
  relationShipType: string;
  targetLabel: string;
};

function validate(cypher: string, schema: RelationShipTuple[]): string;
```

It will return `' '` for invalid Cypher and will otherwise correct the arrow heads on directed queries to match the schema, when possible.

Copyright 2023, Sebastian Mueller, yWorks GmbH

[Licensed under MIT](license.md)