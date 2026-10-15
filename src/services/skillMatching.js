const normalizeJobText = (value) => String(value || "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim()
  .replace(/\s+/g, " ");

const SKILL_ALIASES = {
  "react": ["react", "reactjs", "react js", "react.js"],
  "next.js": ["next", "nextjs", "next js", "next.js"],
  "node.js": ["node", "nodejs", "node js", "node.js"],
  "typescript": ["typescript"],
  "javascript": ["javascript", "ecmascript"],
  "postgresql": ["postgres", "postgresql", "psql"],
  "mongodb": ["mongo", "mongodb"],
  "rest apis": ["rest", "rest api", "rest apis", "restful api", "restful apis"],
  "graphql": ["graphql", "graph ql"],
  "react native": ["react native"],
  "angular": ["angular", "angularjs"],
  "azure": ["azure", "microsoft azure"],
  "azure devops": ["azure devops"],
  "aws": ["aws", "amazon web services"],
  "docker": ["docker", "containerization", "containers"],
  "kubernetes": ["kubernetes", "k8s"],
  "python": ["python"],
  "java": ["java"],
  "sql": ["sql", "structured query language"],
  "git": ["git", "github", "gitlab"],
  "html": ["html", "html5"],
  "css": ["css", "css3"],
  "tailwind css": ["tailwind", "tailwind css"],
};

const aliasToCanonical = new Map(Object.entries(SKILL_ALIASES).flatMap(([canonical, aliases]) => aliases.map((alias) => [normalizeJobText(alias), canonical])));

export function canonicalSkill(value) {
  const normalized = normalizeJobText(value);
  return aliasToCanonical.get(normalized) || normalized;
}

function containsTerm(text, term) {
  const normalizedText = ` ${normalizeJobText(text)} `;
  const normalizedTerm = ` ${normalizeJobText(term)} `;
  return normalizedText.includes(normalizedTerm);
}

export function extractSkills(text) {
  return [...new Set(Object.entries(SKILL_ALIASES)
    .filter(([, aliases]) => aliases.some((alias) => containsTerm(text, alias)))
    .map(([canonical]) => canonical))];
}

export function matchSkills(profileSkills = [], jobSkills = [], jobText = "") {
  const candidate = [...new Set(profileSkills.map(canonicalSkill).filter(Boolean))];
  const required = [...new Set((jobSkills.length ? jobSkills : extractSkills(jobText)).map(canonicalSkill).filter(Boolean))];
  const matching = candidate.filter((skill) => required.includes(skill) || containsTerm(jobText, skill));
  const missing = required.filter((skill) => !matching.includes(skill));
  return { candidate, required, matching, missing };
}
