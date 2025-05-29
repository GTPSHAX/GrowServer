import { type LibSQLDatabase } from "drizzle-orm/libsql";
import { eq, sql } from "drizzle-orm";
import { updates } from "../schemas/Update";

export class UpdateDB {
  constructor(private db: LibSQLDatabase<Record<string, never>>) {}

  public async get(id: number) {
    const res = await this.db
      .select()
      .from(updates)
      .where(eq(updates.id, id))
      .limit(1)
      .execute();

    if (res.length) return res[0];
    return undefined;
  }

  public async has_in_title(text: string) {
    const res = await this.db
      .select({ count: sql`count(*)` })
      .from(updates)
      .where(eq(updates.title, text))
      .limit(1)
      .execute();

    return (res[0].count as number) > 0;
  }

  public async set(title: string, contributors: string = "Developers", description: string = "No description.") {
    if (!title) return -1;

    const res = await this.db.insert(updates).values({
      title:        title,
      description:  description,
      contributors: contributors
    });

    if (res && res.lastInsertRowid) return res.lastInsertRowid;
    return 0;
  }

  public async save(id: number, title: string, contributors: string = "Developers", description: string = "No description.") {
    if (!id || !title) return false;

    const res = await this.db
      .update(updates)
      .set({
        title:        title,
        description:  description,
        contributors: contributors,
        updated_at:   new Date().toISOString().slice(0, 19).replace("T", " ")
      })
      .where(eq(updates.id, id))
      .returning({ id: updates.id });

    if (res.length) return true;
    else return false;
  }
}
