<img src="assets/readme/hero.svg?v=3" width="100%" alt="Zamma skills: lluvia de código estilo Matrix, una figura hecha de código esquiva balas arqueándose hacia atrás, y las skills en-criollo, ollama-agent y motion-art terminan de cargarse">

# skills

Colección personal de [skills de Claude Code](https://docs.claude.com/en/docs/claude-code/skills) — instrucciones empaquetadas que Claude Code carga para tareas puntuales.

## Qué hay

| Skill | Qué hace |
|---|---|
| [`en-criollo`](en-criollo/) | Reescribe un hallazgo o diagnóstico técnico en criollo, corto y listo para mandar a alguien no técnico. |
| [`ollama-agent`](ollama-agent/) | Corre un agente de Claude Code completo (herramientas, MCP, archivos) sobre un modelo de Ollama: DeepSeek, GLM, Kimi o cualquier `*:cloud`. Para delegar planes, premortems o revisiones en paralelo. |
| [`motion-art`](motion-art/) | Pinturas hechas con código que parecen pintadas a mano, quietas o animadas: un objeto cotidiano hiperreal dentro de una tradición artística, con p5.js + p5.brush. Incluye animación a partir de una línea `MOTION:`. |

## Cómo se usan

Cada skill vive en su propia carpeta con un `SKILL.md`. Cloná el repo dentro de `~/.claude/skills/` (o el path de skills que uses) y Claude Code las detecta solas; se invocan con `/nombre-skill` o solas cuando el contexto calza.

## Agregar una skill nueva

Carpeta nueva con su `SKILL.md` (frontmatter `name` + `description`, instrucciones abajo). Sin build, sin config — el README de cada skill es opcional pero ayuda a navegar el repo desde GitHub.
