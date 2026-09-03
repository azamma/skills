<img src="assets/readme/hero.svg?v=2" width="100%" alt="En criollo: termo y mate al atardecer en la pampa">

Vos investigás con jerga técnica. El que te lee, no. Esta skill traduce.

## Qué hace

`en-criollo` agarra un hallazgo, diagnóstico o respuesta técnica y lo reescribe corto, en criollo — sin nombres de clase, sin endpoints, sin queries, sin stack traces. Deja solo lo que el lector necesita para actuar: veredicto primero, después qué pasó, después qué sigue.

Se activa cuando pedís algo "en criollo", en palabras simples, o para alguien no técnico — y también sola, cuando el resultado de una investigación claramente va para alguien que no es ingeniero.

## Antes / después

**Antes** (lo que sabés vos):

> El timeout del webhook de `ms-payments` estaba en 3s pero el proveedor tarda ~5s en confirmar bajo carga; la orden quedaba en `PENDING_CONFIRMATION` y el cron de reconciliación recién la tomaba a los 15 min.

**Después** (lo que recibe el otro):

> **Sí, el pago se confirmó, solo tardó más de lo normal.** El sistema esperaba la confirmación del proveedor y esta vez demoró más de lo que soportaba el chequeo automático, así que quedó "en espera" unos 15 minutos hasta que el proceso de control lo revisó y lo cerró bien. No hace falta ninguna acción — ya está resuelto.

## Cómo usarla

```
/en-criollo
```

o pasale el destinatario y qué explicarle:

```
/en-criollo para el cliente, por qué se demoró su pago
```

Sin argumentos, calibra sola: registro informal (vos/tuteo) salvo que el canal sea externo o formal. Responde en el idioma de la conversación.

## Reglas del texto que entrega

- **Veredicto primero.** Si hay un sí/no en juego, va en negrita, en la primera frase.
- **Solo lo verificado.** Si algo es inferencia, lo dice como inferencia — este texto se reenvía a clientes.
- **Sin jerga.** Clases, colas, tablas, comandos: afuera. IDs, montos, nombres, fechas con huso horario: adentro.
- **Corto.** Prosa en blockquote, sin tablas ni bullets, máximo ~8 frases.

## Origen del nombre

"En criollo" es como se dice en el Río de la Plata *en palabras simples, sin vueltas* — como te lo explicaría alguien de campo, al lado del fogón, sin tecnicismos de por medio.
