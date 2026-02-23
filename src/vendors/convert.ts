import type { JSONSchema7 } from "json-schema";
import type { OpenAPIV3_1 } from "openapi-types";
import type { ToOpenAPISchemaContext } from "./utils.js";

interface ConvertState {
  /** Maps synthetic `$defs` keys (e.g. `__schema0`) to their promoted component name. */
  defsMap: Record<string, string>;
  /** Stack of named schema identifiers for resolving `$ref: "#"` self-references. */
  refStack: string[];
}

export function convertToOpenAPISchema(
  jsonSchema: JSONSchema7,
  context: ToOpenAPISchemaContext,
): OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject {
  return convertInternal(jsonSchema, context, { defsMap: {}, refStack: [] });
}

function convertInternal(
  jsonSchema: JSONSchema7,
  context: ToOpenAPISchemaContext,
  state: ConvertState,
): OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject {
  const _jsonSchema: Record<string, any> = JSON.parse(
    JSON.stringify(jsonSchema),
  );

  // Handle nullable property conversion
  if ("nullable" in _jsonSchema && _jsonSchema.nullable === true) {
    if (_jsonSchema.type) {
      // Convert type + nullable to type array
      if (Array.isArray(_jsonSchema.type)) {
        // If type is already an array, add null if not present
        if (!_jsonSchema.type.includes("null")) {
          _jsonSchema.type.push("null");
        }
      } else {
        // Convert single type to array with null
        _jsonSchema.type = [_jsonSchema.type, "null"];
      }
    } else {
      // If no type specified but nullable is true, add null type
      _jsonSchema.type = ["null"];
    }

    // Remove the nullable property
    delete _jsonSchema.nullable;
  }

  // Remove $schema reference if present
  if (_jsonSchema.$schema) {
    delete _jsonSchema.$schema;
  }

  const schemaName: string | undefined = _jsonSchema.ref || _jsonSchema.$id;
  if (schemaName) {
    state.refStack.push(schemaName);
  }

  // Process $defs/definitions before other keys so promoted names are
  // available when sibling keys contain $ref pointers into $defs.
  for (const defsKey of ["$defs", "definitions"] as const) {
    if (
      _jsonSchema[defsKey] &&
      typeof _jsonSchema[defsKey] === "object" &&
      !Array.isArray(_jsonSchema[defsKey])
    ) {
      for (const subKey in _jsonSchema[defsKey]) {
        const defSchema = _jsonSchema[defsKey][subKey];
        const promotedName: string | undefined = defSchema.ref || defSchema.$id;
        if (promotedName) {
          state.defsMap[subKey] = promotedName;
        }
        const converted = convertInternal(defSchema, context, state);

        // Entries with ref/$id are promoted to components.schemas by
        // convertInternal via the ref/$id branch below. Entries without
        // (e.g. Effect schemas) must be added explicitly.
        if (!promotedName) {
          context.components.schemas = {
            ...context.components.schemas,
            [subKey]: converted,
          };
        }
      }
      delete _jsonSchema[defsKey];
    }
  }

  // Recursively process nested schemas (excluding $defs/definitions, handled above)
  const nestedSchemaKeys = [
    "properties",
    "additionalProperties",
    "items",
    "additionalItems",
    "allOf",
    "anyOf",
    "oneOf",
    "not",
    "if",
    "then",
    "else",
    "patternProperties",
    "propertyNames",
    "contains",
    // "unevaluatedProperties",
    // "unevaluatedItems",
  ] as const;

  nestedSchemaKeys.forEach((key) => {
    if (
      _jsonSchema[key] &&
      (typeof _jsonSchema[key] === "object" || Array.isArray(_jsonSchema[key]))
    ) {
      if (key === "properties" || key === "patternProperties") {
        // These are objects containing schemas
        for (const subKey in _jsonSchema[key]) {
          _jsonSchema[key][subKey] = convertInternal(
            _jsonSchema[key][subKey],
            context,
            state,
          );
        }
      } else if (key === "allOf" || key === "anyOf" || key === "oneOf") {
        // These are arrays of schemas
        _jsonSchema[key] = _jsonSchema[key].map((item: any) =>
          convertInternal(item, context, state),
        );
      } else if (key === "items") {
        // Items can be a schema or array of schemas
        if (Array.isArray(_jsonSchema[key])) {
          _jsonSchema[key] = _jsonSchema[key].map((item: any) =>
            convertInternal(item, context, state),
          );
        } else {
          _jsonSchema[key] = convertInternal(
            _jsonSchema[key],
            context,
            state,
          );
        }
      } else {
        // Single schema properties
        _jsonSchema[key] = convertInternal(_jsonSchema[key], context, state);
      }
    }
  });

  if (schemaName) {
    state.refStack.pop();
  }

  // If a ref is provided, use it to create a $ref in the OpenAPI components
  if (_jsonSchema.ref || _jsonSchema.$id) {
    const { ref, $id, ...component } = _jsonSchema;

    const id = ref || $id;

    context.components.schemas = {
      ...context.components.schemas,
      [id]: component,
    };
    return {
      $ref: `#/components/schemas/${id}`,
    };
  }

  if (_jsonSchema.$ref) {
    const rawRef: string = _jsonSchema.$ref;

    // Resolve $ref: "#" self-references using the refStack
    if (rawRef === "#") {
      const parentName =
        state.refStack.length > 0
          ? state.refStack[state.refStack.length - 1]
          : undefined;
      if (parentName) {
        return { $ref: `#/components/schemas/${parentName}` };
      }
      return _jsonSchema as OpenAPIV3_1.ReferenceObject;
    }

    // Resolve $ref pointers into $defs/definitions using the defsMap
    if (rawRef.startsWith("#/$defs/") || rawRef.startsWith("#/definitions/")) {
      const defName = rawRef.startsWith("#/$defs/")
        ? rawRef.slice("#/$defs/".length)
        : rawRef.slice("#/definitions/".length);
      const resolved = state.defsMap[defName] || defName;
      return { $ref: `#/components/schemas/${resolved}` };
    }

    // Happens in Effect schemas — remove the '#/$defs/' prefix from internal references
    const { $ref, $defs, ...rest } = _jsonSchema;
    const ref = ($ref as string).split("/").pop();
    context.components.schemas = {
      ...context.components.schemas,
      ...$defs,
    };
    return {
      $ref: `#/components/schemas/${ref}`,
      ...rest,
    } as OpenAPIV3_1.ReferenceObject;
  }

  return _jsonSchema;
}
