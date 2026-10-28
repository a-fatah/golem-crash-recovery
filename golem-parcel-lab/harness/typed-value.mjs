/** Decode the schema-driven JSON values returned by this application's CLI. */
export function decodeTypedValue(typed) {
  if (!typed || !typed.graph || !typed.value) return typed;
  const definitions = new Map((typed.graph.defs ?? []).map((definition) => [definition.id, definition.body]));
  function decode(schema, value) {
    if (schema.kind === 'ref') {
      const body = definitions.get(schema.value.id);
      if (!body) throw new Error(`Missing Golem schema definition ${schema.value.id}`);
      return decode(body, value);
    }
    if (schema.kind !== value.kind) throw new Error(`Golem value/schema mismatch: ${value.kind}/${schema.kind}`);
    if (schema.kind === 'record') {
      return Object.fromEntries(schema.value.fields.map((field, index) => [field.name, decode(field.body, value.value.fields[index])]));
    }
    if (schema.kind === 'tuple') return schema.value.elements.map((element, index) => decode(element, value.value.elements[index]));
    if (schema.kind === 'list' || schema.kind === 'fixed-list') return value.value.elements.map((element) => decode(schema.value.element, element));
    if (schema.kind === 'option') return value.value.inner === null ? null : decode(schema.value.inner, value.value.inner);
    if (schema.kind === 'enum') {
      const name = schema.value.cases[value.value.case];
      if (typeof name !== 'string') throw new Error('Golem enum case is outside its schema');
      return name;
    }
    if (schema.kind === 'variant') {
      const selected = schema.value.cases[value.value.case];
      if (!selected) throw new Error('Golem variant case is outside its schema');
      return selected.payload
        ? { tag: selected.name, val: decode(selected.payload, value.value.payload) }
        : { tag: selected.name };
    }
    if (schema.kind === 'result') {
      const tag = value.value.tag;
      if (tag !== 'ok' && tag !== 'err') throw new Error('Invalid Golem result tag');
      const payload = schema.value.spec[tag];
      return payload ? { tag, val: decode(payload, value.value.value) } : { tag };
    }
    if (['bool', 'string', 'char', 'f32', 'f64', 's8', 's16', 's32', 's64', 'u8', 'u16', 'u32', 'u64'].includes(schema.kind)) return value.value;
    throw new Error(`This application's CLI decoder does not support Golem value kind ${schema.kind}`);
  }
  return decode(typed.graph.root, typed.value);
}
