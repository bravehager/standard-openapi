import { describe, expect, it } from "vitest";
import z from "zod/v4";

import { toOpenAPISchema } from "~/index.js";

describe("zod v4", () => {
  it("basic", async () => {
    const schema = z
      .object({
        myString: z.string(),
        myUnion: z.union([z.number(), z.boolean()]),
      })
      .describe("My neat object schema");

    const specs = await toOpenAPISchema(schema);
    expect(specs).toMatchSnapshot();
  });

  it("with metadata", async () => {
    const schema = z
      .object({
        myString: z.string(),
        myUnion: z.union([z.number(), z.boolean()]),
      })
      .describe("My neat object schema")
      .meta({
        ref: "MyNeatObjectSchema",
      });

    const specs = await toOpenAPISchema(schema);
    expect(specs).toMatchSnapshot();
  });

  describe("recursive schemas (z.lazy)", () => {
    it("standalone self-referencing schema", async () => {
      const TreeNode: z.ZodType<{
        value: string;
        children: TreeNode[];
      }> = z
        .object({
          value: z.string(),
          children: z.array(z.lazy(() => TreeNode)),
        })
        .meta({ ref: "TreeNode" });

      type TreeNode = z.infer<typeof TreeNode>;

      const specs = await toOpenAPISchema(TreeNode);
      expect(specs).toMatchSnapshot();
    });

    it("recursive schema with union embedded in parent", async () => {
      const Leaf = z
        .object({ value: z.string() })
        .meta({ ref: "Leaf" });

      const TreeNode: z.ZodType<{
        label: string;
        children: Array<z.infer<typeof Leaf> | { label: string; children: any[] }>;
      }> = z
        .object({
          label: z.string(),
          children: z.array(
            z.lazy(() => z.union([Leaf, TreeNode])),
          ),
        })
        .meta({ ref: "TreeNode" });

      const Forest = z
        .object({
          name: z.string(),
          root: TreeNode.nullable(),
        })
        .meta({ ref: "Forest" });

      const specs = await toOpenAPISchema(Forest);
      expect(specs).toMatchSnapshot();
    });
  });
});
