# ollama-agent

Correr un agente de Claude Code completo (herramientas, servidores MCP, lectura y escritura de archivos, varias vueltas) sobre un modelo que no es de Anthropic: DeepSeek, GLM, Kimi, Qwen, gpt-oss o cualquier `*:cloud` de Ollama.

## Qué hace

Ollama expone una API compatible con la de Anthropic en `http://localhost:11434`, para modelos locales y para los de Ollama Cloud. La skill lanza `claude -p` apuntado ahí, así el modelo recibe todo el harness de Claude Code y no solo un prompt. El tool `Agent` de Claude Code no puede hacerlo: su campo `model` solo acepta modelos de Anthropic.

Sirve para delegar trabajo acotado y bien especificado que necesita herramientas:

- leer código y citar `archivo:línea` para un plan o un premortem;
- replicar un diseño aprobado en un archivo de diseño por MCP;
- revisar un diff contra una checklist;
- correr varios agentes baratos en paralelo, cada uno sin ver al otro.

Para tareas de solo texto, donde todo el input entra en el prompt (resumir, clasificar, reescribir), conviene una llamada directa a `/api/chat` de Ollama.

## Cómo usarla

Se activa sola cuando pedís "mandá a un DeepSeek / GLM / Kimi" o nombrás un modelo de Ollama para trabajo con herramientas. A mano:

```bash
scripts/models.sh                                   # modelos locales + catálogo de Ollama Cloud
scripts/run.sh deepseek-v4.1-flash:cloud - <<<"Reply with the single word: pong"
scripts/run.sh glm-5.3-flash:cloud spec.md /tmp/plan --tools "Read Grep Glob" --max-turns 200
```

`run.sh` arma las variables de entorno, pone el prompt antes de `--allowedTools` (ese flag se come todo lo que viene después), cierra stdin, guarda el JSON en `<prefijo>.out` y los errores en `<prefijo>.err`, e imprime el texto final con `turns`, `is_error` y `subtype`.

Otro gateway compatible con Anthropic funciona igual: `OLLAMA_AGENT_URL` y, si hace falta, `OLLAMA_AGENT_KEY`.

## Lo que hay que saber

- **Los modelos `:cloud` corren en los servidores de Ollama.** La spec y cada archivo o salida de herramienta que el agente lea salen de tu máquina. Para código o datos privados, pedí permiso o usá un modelo local.
- **La spec es todo lo que ve el modelo:** objetivo, archivos que puede tocar, reglas, cómo verificar y dónde escribir el reporte.
- **Mínimas herramientas.** Un plan o una revisión llevan `Read Grep Glob`, sin `Bash` ni `Edit`.
- **Un solo escritor por recurso compartido** (un archivo de diseño, el índice de git); los lectores pueden ir en paralelo.
- **El resultado es una afirmación, no un hecho.** Verificá las citas, corré los tests, mirá el PNG exportado.
- **No son errores:** `[claude-code:unrecognized_model]` (busca el precio) y "claude.ai connectors are disabled". El costo que trae el JSON está calculado con precios de Anthropic, así que no vale.

## Requisitos

[Claude Code](https://docs.claude.com/en/docs/claude-code) y [Ollama](https://ollama.com) corriendo. Para los modelos `:cloud`, una cuenta de Ollama con sesión iniciada (`ollama signin`).
