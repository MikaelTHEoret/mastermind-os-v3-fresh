export type GedcomFact = { date?: string; place?: string };
export type GedcomPerson = {
  id: string; name: string; given: string; surname: string; sex?: string;
  birth?: GedcomFact; baptism?: GedcomFact; death?: GedcomFact;
  famc: string[]; fams: string[]; sourceRefs: number;
};
export type GedcomFamily = {
  id: string; husband?: string; wife?: string; children: string[]; marriage?: GedcomFact;
};
export type GedcomDocument = { people: GedcomPerson[]; families: GedcomFamily[] };

const cleanName = (value: string) => value.replace(/\//g, '').replace(/\s+/g, ' ').trim();

export function yearOf(value?: string): number | null {
  const years = value?.match(/\b(?:1[0-9]{3}|20[0-9]{2})\b/g)?.map(Number) ?? [];
  return years.length ? Math.min(...years) : null;
}

export function normalizeIdentity(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function parseGedcom(text: string): GedcomDocument {
  const people = new Map<string, GedcomPerson>();
  const families = new Map<string, GedcomFamily>();
  let person: GedcomPerson | null = null;
  let family: GedcomFamily | null = null;
  let fact: { target: GedcomFact } | null = null;

  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = raw.match(/^(\d+)\s+(?:(@[^@]+@)\s+)?([A-Za-z0-9_]+)(?:\s+(.*))?$/);
    if (!match) continue;
    const level = Number(match[1]); const xref = match[2]; const tag = match[3].toUpperCase(); const value = (match[4] ?? '').trim();
    if (level === 0) {
      person = null; family = null; fact = null;
      if (xref && tag === 'INDI') { person = { id:xref, name:'Unknown', given:'', surname:'', famc:[], fams:[], sourceRefs:0 }; people.set(xref, person); }
      if (xref && tag === 'FAM') { family = { id:xref, children:[] }; families.set(xref, family); }
      continue;
    }
    if (person) {
      if (level === 1) fact = null;
      if (level === 1 && tag === 'NAME') {
        person.name = cleanName(value) || 'Unknown';
        const parts = value.split('/'); person.given = (parts[0] ?? '').trim(); person.surname = (parts[1] ?? '').trim();
      } else if (level === 1 && tag === 'SEX') person.sex = value;
      else if (level === 1 && tag === 'FAMC') person.famc.push(value);
      else if (level === 1 && tag === 'FAMS') person.fams.push(value);
      else if (tag === 'SOUR') person.sourceRefs++;
      else if (level === 1 && ['BIRT','BAPM','CHR','DEAT'].includes(tag)) {
        const target: GedcomFact = {};
        if (tag === 'BIRT') person.birth = target; else if (tag === 'DEAT') person.death = target; else person.baptism = target;
        fact = { target };
      } else if (level === 2 && fact && tag === 'DATE') fact.target.date = value;
      else if (level === 2 && fact && tag === 'PLAC') fact.target.place = value;
      continue;
    }
    if (family) {
      if (level === 1) fact = null;
      if (level === 1 && tag === 'HUSB') family.husband = value;
      else if (level === 1 && tag === 'WIFE') family.wife = value;
      else if (level === 1 && tag === 'CHIL') family.children.push(value);
      else if (level === 1 && tag === 'MARR') { family.marriage = {}; fact = { target:family.marriage }; }
      else if (level === 2 && fact && tag === 'DATE') fact.target.date = value;
      else if (level === 2 && fact && tag === 'PLAC') fact.target.place = value;
    }
  }
  return { people:[...people.values()], families:[...families.values()] };
}

