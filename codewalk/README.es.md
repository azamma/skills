<p><img src="assets/readme/walks.png" width="100%" alt="La página Walks: primero los walks nuevos y actualizados, uno con dos paradas sin encontrar, un walk para seguir leyendo, uno cuyo código cambió, y las carpetas"></p>

# codewalk

[English](README.md) · **Español**

Tu agente te muestra el código que sostiene su respuesta como un **walk**: unas pocas paradas por código real, cada una con
una frase sobre qué mirar. Los walks llegan a una página local, Walks, y esperan ahí hasta que los abrís. Cuando la respuesta
es para alguien que no tiene los repos, el mismo walk sale como un bloque HTML para pegar en un artifact.

<p><img src="assets/readme/walk.png" width="100%" alt="Un walk en la parada 3 de 5: los archivos a la izquierda, el código con las líneas de la parada resaltadas y la frase del agente abajo, las paradas a la derecha"></p>

## Qué hace

- **`walk`** guarda el walk como un JSON en `~/.codewalk/walks/`, en una carpeta si se la pasás, y le dice al agente en el
  momento qué paradas no pudo ubicar, así las corrige antes de que lo mires.
- **La página Walks** (`http://127.0.0.1:8777/`) es una bandeja: primero los walks nuevos y actualizados, el que estabas
  leyendo, los que tienen código que cambió desde que se guardaron, y todos por carpeta. Nada se abre solo; un walk nuevo
  muestra un aviso. Vos movés walks entre carpetas, los borrás y copiás un pedido armado para que el agente arregle o
  actualice uno.
- **Un walk** avanza a ritmo de lectura, o parada por parada. Si el agente reemplaza el walk que estás leyendo, la versión
  nueva entra en el lugar y seguís en la misma parada.
- **`block`** arma el walk como un bloque HTML autocontenido (código resaltado, siempre oscuro) para un artifact.

Cualquier lenguaje: una parada puede nombrar un símbolo (`OrderService#place`, `parser#Parse`, `User#valid?`), y el CLI
encuentra su definición con `git grep` y Pygments, o una ruta con líneas (`config/limits.yml:3-8`).

## Cómo se usa

Se activa sola cuando preguntás "dónde está X", "haceme el recorrido de Y", o cuando el agente encuentra en el código algo que
tenés que ver. A mano, desde la carpeta de la skill:

```bash
uv run scripts/codewalk.py walk --title "Cómo se arma un pedido" --folder "Checkout" <<'EOF'
shop OrderController#place Toma el carrito y valida el stock antes que nada
shop config/limits.yml:3-8 Los límites por cliente viven acá
EOF
uv run scripts/codewalk.py open             # la página Walks
uv run scripts/codewalk.py list             # los walks guardados y sus ids
uv run scripts/codewalk.py block -o block.html < stops.txt
uv run scripts/codewalk.py selftest
```

Necesita `uv` y `git`. `uv` instala la única dependencia, [Pygments](https://pygments.org/) (BSD), la primera vez.

## Para tener en cuenta

- **Solo lectura y local.** El server escucha en `127.0.0.1`, rechaza otros hosts y pedidos cross-site, y solo sirve archivos
  que un walk nombra y que git sigue en ese repo. Nunca escribe en un repo.
- **Encontrar símbolos es una heurística.** Reconoce definiciones por palabra clave (`def`, `fn`, `func`, `class`, `struct`,
  `impl`…), por declaraciones estilo C y por métodos de JS/TS; dónde termina una definición sale de las llaves o de la
  sangría. Una parada que no logra ubicar vuelve `unresolved`, o `ambiguous` con candidatos, y el agente la reenvía como ruta.
- **Qué viste y dónde dejaste de leer** se guarda en tu navegador (localStorage), no con los walks.
- Los archivos de más de 1 MB y los binarios no se muestran.
- Las pantallas se diseñaron en Open Design (proyecto *Codewalk*).
