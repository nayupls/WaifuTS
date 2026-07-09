import { defineSchema, defineTable, v } from "@chisa/client";

const schema = defineSchema({
  todos: defineTable({
    text: v.string(),
    done: v.boolean(),
    priority: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
  }),
});

export default schema;
export type Schema = typeof schema;
