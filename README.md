<img src="assets/readme/hero.svg?v=1" width="100%" alt="skills: silueta en code-rain estilo matrix haciendo un one-hand handstand">

# skills

Colección personal de [skills de Claude Code](https://docs.claude.com/en/docs/claude-code/skills) — instrucciones empaquetadas que Claude Code carga para tareas puntuales.

## Qué hay

| Skill | Qué hace |
|---|---|
| [`en-criollo`](en-criollo/) | Reescribe un hallazgo o diagnóstico técnico en criollo, corto y listo para mandar a alguien no técnico. |

## Cómo se usan

Cada skill vive en su propia carpeta con un `SKILL.md`. Cloná el repo dentro de `~/.claude/skills/` (o el path de skills que uses) y Claude Code las detecta solas; se invocan con `/nombre-skill` o solas cuando el contexto calza.

## Agregar una skill nueva

Carpeta nueva con su `SKILL.md` (frontmatter `name` + `description`, instrucciones abajo). Sin build, sin config — el README de cada skill es opcional pero ayuda a navegar el repo desde GitHub.
