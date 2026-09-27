# Run de sub-agente "failed" con el trabajo ya commiteado

## Summary

El runtime reporta el run como failed por Unauthorized, pero el sub-agente ya termino su tarea y la
commiteo antes de morir.

## Context

- Aparece con `team_run_task` en modo async cuando el sub-agente termina y muere en la llamada de
  cierre, asi que el veredicto del run describe como fallo lo que en realidad fue el reporte.
- El error es siempre el mismo: `Unauthorized: Please make sure you're using the latest version of
  Cline and re-authenticate your Cline account.`
- El commit ya esta hecho cuando el run muere: el trabajo no se pierde. Lo que falta es el reporte.
- Medido en la sesion de las specs 028, 029 y 030: los runs 00004, 00005 y 00006 fallaron asi (uno
  dejo archivos sin commitear y los otros no habian arrancado); los relanzados 00007, 00008 y 00009
  completaron. Despues, los runs 00010 y 00012 completaron y el 00011 fallo igual, pero su commit
  `33fe56e` estaba en la rama y el archivo existia con su contenido completo.

## Solution

1. No relanzar a ciegas ni dar la tarea por perdida: mirar git primero, que es la unica fuente
   confiable del estado real.
   `git -C <worktree> log --oneline origin/main..HEAD` y `git -C <worktree> status --short`.
2. Si el commit esta, la tarea esta hecha: seguir con la validacion normal y no repetir el trabajo.
3. Si hay cambios sin commitear, relanzar con la instruccion explicita de retomar ese trabajo
   (revisarlo contra la spec, completarlo y commitearlo), nunca de reescribirlo desde cero. El
   worktree conserva lo que se hizo.
4. El reporte ausente no bloquea nada: el orquestador valida contra el codigo, las aserciones y los
   humos, que es la verificacion que importa.

## Tags

<cline> <sub-agentes> <runs> <git> <worktree> <windows>
