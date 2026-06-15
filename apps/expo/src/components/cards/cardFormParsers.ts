/**
 * Form input parsers — mirror Swift BusinessCardFormView's parseCSV /
 * parseSkills / parseSocialNetworks / nilIfEmpty helpers.
 *
 * Keep these stateless so the form component stays small and so the parsers
 * can be unit-tested without renderer setup.
 */
import { uuid, type Skill, type SocialNetwork } from '@solidarity/shared';

export function parseCSV(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function parseSkills(raw: string): Skill[] {
  return parseCSV(raw).map((name) => ({
    id: uuid(),
    name,
    category: 'General',
    proficiencyLevel: 'Intermediate',
  }));
}

export function parseSocialNetworks(linkedIn: string, github: string): SocialNetwork[] {
  const out: SocialNetwork[] = [];
  const li = linkedIn.trim();
  if (li.length > 0) {
    out.push({
      id: uuid(),
      platform: 'LinkedIn',
      username: li,
      url: `https://linkedin.com/in/${li}`,
    });
  }
  const gh = github.trim();
  if (gh.length > 0) {
    out.push({
      id: uuid(),
      platform: 'GitHub',
      username: gh,
      url: `https://github.com/${gh}`,
    });
  }
  return out;
}

export function nilIfEmpty(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
