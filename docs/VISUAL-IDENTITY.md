# Pyrite - Identidad visual

> El color de Pyrite no decora: codifica. Este doc fija la paleta y las reglas; los valores viven en
> `apps/frontend/src/theme/tokens.css`, que es la unica fuente de verdad. Si algo aca y el archivo
> discrepan, manda el archivo, y se corrige este doc.

**Concepto:** instrumento de precision, no dashboard. Neutros calidos, un solo acento frio, y el color
aparece solo cuando significa algo.

**Regla base: un color codifica una sola cosa por vista.**

## Tokens base (Dark)

```css
/* Superficies: 4 niveles, pasos de L parejos */
--bg:             #0F0E0E;
--surface-1:      #161515;  /* panel lateral, header */
--surface-2:      #1E1D1D;  /* cards, inputs */
--surface-3:      #272626;  /* hover, popovers */
--border-subtle:  #2A2929;  /* separadores, sidebar edge */
--border-strong:  #403E3E;  /* inputs, foco pasivo */

/* Texto */
--text-1: #E1E3E6;
--text-2: #A3A5A8;
--text-3: #7D7F82;   /* piso legible, nunca menos */
--text-disabled: #55575A;

/* Marca / acciones */
--primary:        #97BEEB;
--primary-hover:  #B0CFF2;
--primary-active: #7FAEE0;
--primary-fg:     #0F0E0E;  /* texto sobre boton: oscuro, no blanco */
--primary-subtle: rgb(151 190 235 / .12);  /* seleccion, item activo */
--focus-ring:     #97BEEB;  /* 2px + offset 2px */
--secondary:      #61899B;  /* iconos, bordes de boton secundario */

/* Skeleton */
--skel-base:      #1E1D1D;
--skel-highlight: #2C2E31;  /* leve tinte frio hacia el primario */

/* Estados: texto/icono claro + fondo tintado + solid */
--ok-fg:   #6FCF8A;  --ok-bg:   rgb(111 207 138 / .12);  --ok-solid:   #2F8F46;
--warn-fg: #E3C25B;  --warn-bg: rgb(227 194 91 / .12);   --warn-solid: #B8901F;
--err-fg:  #F27470;  --err-bg:  rgb(242 116 112 / .12);  --err-solid:  #C70101;
--info-fg: var(--primary);
```

## Decisiones y por que

- **Panel lateral:** `surface-1` + un borde `border-subtle` de 1px. No le des otro matiz; la
  separacion viene de luminosidad, no de color.
- **Botones:** primario = relleno `--primary` con texto oscuro. Secundario = borde `--secondary`, sin
  relleno. Ghost = solo hover a `surface-3`. Destructivo = outline `--err-fg` y relleno solo en el
  paso de confirmacion. Maximo un boton primario por vista.
- **Skeleton:** shimmer de `skel-base` a `skel-highlight`, 1.6-2s, y desactivalo con
  `prefers-reduced-motion`. Usa un gradiente estatico si el usuario reduce movimiento.
- **Ultra Dark:** solo redefine `--bg` (#000) y baja las superficies un paso. Si el sistema esta bien
  tokenizado, un tema son ~8 overrides, no una paleta nueva.
- **Light:** el primario se **deriva**, no se reutiliza: ~`#2F6DB5` con `fg` blanco. `#97BEEB` sobre
  blanco no llega ni a 2:1.

## Los tres dominios con mas riesgo

**Calendario.** Codifica con forma primero y color despues:

- Hoy: anillo/relleno `--primary` en el numero. Es lo unico con relleno de acento.
- Pendiente: circulo hueco `text-1`. Hecha: check `text-3`, sin tachar todo.
- Vencida: `--err-fg`. Suscripcion: Apricot `#EBC497`, ese es su trabajo ("cargo recurrente"), y a
  <=3 dias de cobro pasa a `--warn-fg`.

**Consumo de agentes.** Aca esta la trampa: el color identifica al agente o mide el consumo? Si mezclas
ambos, un agente azul al 95% parece sano. Separa:

- Magnitud: una sola rampa del primario (barra/grafico).
- Umbrales: 80% -> warn, 95% -> err (semanticos, nunca categoricos).
- Identidad del agente: icono/monograma, con un punto de color como refuerzo.

**Finanzas (monedas y metodos).** Categoricos aparte de los semanticos, con L~75 y chroma bajo:

```
violeta #B7A0E6 . cian #6CC5CF . rosa #E0A0C0 . apricot #EBC497 . slate #61899B
```

- Evita hues de verde, amarillo y rojo en categoricos: un "ARS" verde se lee como exito.
- Con mas de ~5 series el color deja de discriminar. La moneda siempre lleva codigo ISO (`ARS`,
  `USD`) como texto; el color es un extra, no el identificador.
- Ingresos/egresos: signo y posicion (+/-), no verde/rojo. Reserva rojo para errores y alertas reales.

## Arquitectura (lo que evita reescribir todo)

Tres capas: **primitivos** (`blue-300`) -> **semanticos** (`--primary`) -> **componentes**
(`--button-bg`). Los componentes solo leen la capa 3. Los customs cambian un primitivo (hue del acento)
y OKLCH recalcula hover/active/subtle/fg por contraste automaticamente.

Hoy hay dos capas, no tres: la paleta semantica (`tokens.css`) y los alias que consume el codigo
(`--color-primary`, `--color-text-1`, ...). La capa de primitivos entra cuando existan los custom.

**Los valores de contraste son estimados a ojo: validalos con APCA antes de fijarlos.**

## Colision acento / estado: la decision

El caso que habia que definir es que pasa cuando el usuario elige un acento custom verde o rojo, con
verde/rojo ya cargando significado. Queda asi:

**1. El acento tiene hues prohibidos.** El selector no ofrece los rangos que ya significan estado. En
grados OKLCH (H):

- Prohibidos: `5-45` (rojo/naranja), `60-105` (ambar/amarillo), `120-165` (verde).
- Permitidos: `175-345` (cian, azul, violeta, rosa). El default `#97BEEB` vive ahi (~240).

El control explica el motivo ("reservado para estados"), no devuelve un error opaco.

**2. El estado nunca se comunica solo por color.** Todo estado lleva icono + texto, siempre. Es la
segunda linea de defensa y no depende del custom: cubre daltonismo (~8% de los hombres en el eje
rojo/verde), una paleta que el usuario eligio sin saber de semantica, y una captura en blanco y negro.
Si el color se pierde, el significado queda.

**3. Si aun asi colisionan en la misma vista, gana el estado y el acento se retira.** El acento es
posicional (controles, seleccion, item activo); el estado es semantico. Un acento custom nunca puede
tapar un error.

**4. El acento no toca las superficies de significado.** La escena del arranque y las rampas de
magnitud usan el azul como dato, no como "color del usuario": cambiarlo cambiaria la lectura.

Cuando exista el custom, se implementa como primitivo de hue + OKLCH para derivar hover/active/subtle
y el `fg` por contraste, con piso: si la L derivada no alcanza el contraste, sube o baja hasta
alcanzarlo.

## Lo que se midio

Contraste WCAG real de la paleta (no estimado), sobre los pares que importan:

| Par | Ratio | Lectura |
|---|---|---|
| text-1 sobre bg | 14.99 | sobra |
| text-1 sobre surface-2 | 13.08 | sobra |
| text-2 sobre surface-2 | 6.81 | bien |
| text-3 sobre bg | 4.80 | bien |
| **text-3 sobre surface-2** | **4.19** | **el piso legible roza el limite en cards** |
| text-disabled sobre surface-2 | 2.32 | correcto: esta deshabilitado |
| primary sobre bg | 9.99 | bien |
| **primary-fg sobre primary** | **9.99** | **valida el texto oscuro sobre el boton** |
| secondary sobre bg | 5.10 | bien (pide 3 como icono/borde) |
| secondary sobre surface-2 | 4.45 | justo |
| **border-strong sobre bg** | **1.81** | **no llega al 3:1 de componentes de UI** |
| border-subtle sobre surface-1 | 1.26 | bien: es separador, no delimita un control |
| ok / warn / err fg sobre su tinte | 6.94 / 7.48 / 5.07 | bien |
| cat-violet / cyan / pink / apricot sobre surface-2 | 7.36 / 8.43 / 7.98 / 10.31 | bien |
| cat-slate sobre surface-2 | 4.45 | justo (mismo caso que secondary) |

Dos hallazgos que piden decision (no se tocan sin acuerdo, porque cambian la paleta):

1. **`text-3` sobre las superficies 2 y 3 queda en 4.19.** Si el piso tiene que ser 4.5 para texto
   normal, el valor sube (~`#8A8C8F`). Si `text-3` se reserva a texto grande (>=18.66px o 14pt bold),
   queda como esta. Hay que elegir una.
2. **`border-strong` (1.81) no alcanza el 3:1** que WCAG 1.4.11 pide cuando el borde es la unica
   senal de un control. Hoy no es la unica (el input cambia de superficie), pero conviene saberlo
   antes de apoyarse en el borde solo.

Un tercer hallazgo, ya previsto: el tinte de `warn` (`#363124`) y el de apricot categorico
(`#37312C`) son casi el mismo color. Confirma la regla dura de que categorico y semantico no comparten
superficie sin texto que los distinga.

## Donde vive

- La paleta: `apps/frontend/src/theme/tokens.css`, mas los alias que ya usa el codigo
  (`--color-background`, `--color-text-1`, ...) para que haya una sola fuente de verdad.
- La escena del arranque (canvas, viñeta, marca y su animacion): `apps/frontend/src/app/globals.css`.
- El componente de particulas: `apps/frontend/src/components/organisms/PyriteParticles.tsx`
  (origen: `_keep/v0-componentes/particulas`).
- Los assets: `apps/frontend/public/assets/` (`voices/`, `sounds/<tipo>/`).

