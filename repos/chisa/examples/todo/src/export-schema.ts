/** Writes chisa.schema.json for the server's --schema flag. */
import { writeFileSync } from "node:fs";
import schema from "./schema.js";

writeFileSync("chisa.schema.json", JSON.stringify(schema.toJSON(), null, 2) + "\n");
console.log("wrote chisa.schema.json");
