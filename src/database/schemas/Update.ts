import { InferSelectModel, sql } from "drizzle-orm";
import { text, integer, sqliteTable, blob } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export const updates = sqliteTable("updates", {
  id:           integer("id").primaryKey({ autoIncrement: true }),
  title:        text("title", { length: 255 }).notNull(),
  description:  text("description").default("No description."),
  contributors: text("contributors").default("Developers"),
  created_at:   text("created_at").default(sql`(current_timestamp)`),
  updated_at:   text("updated_at").default(sql`(current_timestamp)`)
});

export type Updates = InferSelectModel<typeof updates>;
export const insertUpdateSchema = createInsertSchema(updates);
export const selectUpdateSchema = createSelectSchema(updates);