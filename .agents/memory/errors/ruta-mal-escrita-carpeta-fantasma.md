# Una ruta mal escrita crea una copia fantasma del proyecto

## Summary

Con un guion bajo de mas en el path, el archivo se escribe fuera del repo, en una carpeta paralela
que ninguna herramienta del proyecto mira.

## Context

- El proyecto vive en `...\1__Programacion\1-programacion\...`: `1__Programacion` con guion bajo y
  `1-programacion` con guion, distinguidos por mayusculas y por el separador.
- Retipear la ruta de memoria invita a normalizarla mal: `...\1__Programacion\1__programacion\...`
  es otra carpeta para Windows, asi que la herramienta escribe ahi sin ningun error y el archivo
  simplemente no aparece en el repo.
- Paso dos veces: con un archivo escrito desde el editor y con la spec 030, que un sub-agente
  escribio entera en la variante con guion bajo. El sintoma es identico en los dos casos: "el
  archivo no existe" en el path esperado, sin ningun error de escritura.
- Coste real: una spec de 249 lineas que parecia perdida y un ciclo entero de relanzamiento.

## Solution

1. Al escribir, usar la ruta absoluta tal como la da el entorno, sin retipearla de memoria.
2. Si un archivo "no existe", buscarlo en la variante con guion bajo antes de reescribirlo:
   `Get-ChildItem -Path 'D:\1__Programacion\1__programacion' -Recurse -Filter '<nombre>'`
3. Copiarlo al path correcto y verificar el contenido (tamano y primeras lineas) antes de darlo por
   bueno: puede estar completo.
4. Al delegar, dar la ruta absoluta exacta en el prompt y prohibir la variante con guion bajo de
   forma explicita. Detalle del prompt, no del agente: un error de ruta no se detecta leyendo el
   resultado.
5. La carpeta fantasma se borra solo con la confirmacion del usuario: es destructiva.

## Tags

<windows> <paths> <editor> <sub-agentes> <git>
