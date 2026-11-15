# Skills y Nexbots

Nexus utiliza el harness de nas-adk 0.5.0. Un **Nexbot** define quién trabaja y con qué modelo, herramientas, memoria y límites. Una **skill** aporta un procedimiento reutilizable. El ordenador del Nexbot es opcional.

## Usar la biblioteca

En **Skills** puedes crear una skill mediante una conversación, importar un ZIP o una URL pública de GitHub y consultar la galería interna. Los paquetes siguen el formato [Agent Skills](https://agentskills.io/specification): `SKILL.md`, referencias, recursos y scripts opcionales.

La importación abre una vista previa. Al seleccionar un paquete se crea un borrador, sin ejecutar código ni publicarlo. El creador puede escribir sus archivos, explicarlos y proponer ejemplos. La pestaña Archivos permite también editarlos directamente. Una actualización muestra el contenido anterior y el nuevo antes de publicar.

**Publicar versión** añade una versión inmutable a tu biblioteca privada y la habilita para el chat. Compartir en la galería es otra acción. Añadir una skill de otra persona crea una copia privada independiente. Las actualizaciones son manuales.

En el chat, Nexus decide qué skills utilizar entre las habilitadas. Puedes forzar una mediante el selector Skills o `/nombre-skill`. En un Nexbot solo están disponibles las skills que le hayas asignado, aunque estén deshabilitadas en el chat general. El chat muestra las activaciones junto con los pasos de herramientas.

## Configurar un Nexbot

Su panel contiene identidad e instrucciones, ejecución, skills, memoria y rutinas. La configuración de ejecución reúne modelo, herramientas, conectores, conocimiento, memoria, preferencias de respuesta, presupuestos y política. Sin modelo fijado se hereda el predeterminado de tu cuenta. `@nombre` o el selector del chat eligen el Nexbot.

Un Nexbot sin ordenador puede conversar, trabajar en salas y ejecutar rutinas. Si lo necesita, activa su ordenador y arráncalo. Los modos de escritorio y sala mantienen sus restricciones de herramientas; asignar una skill no las amplía.

## Probar y ejecutar scripts

Las pruebas del creador usan una copia inmutable del borrador y el mismo circuito de runs, credenciales, políticas y cancelación que el chat. No publican cambios ni escriben memoria. Puedes comprobar si aparece un texto esperado o revisar el resultado sin una comprobación automática. Una prueba esperando aprobación permanece pendiente.

Los scripts requieren seleccionar un Nexbot con ordenador en marcha. Se ejecutan en su contenedor, después de una aprobación explícita, sin acceso a las credenciales del modelo. Se incluyen Python, Bash y Node.js; las dependencias adicionales declaradas por una skill no se instalan automáticamente. Los recursos del paquete están en `SKILL_ROOT`, y el workspace persistente en `NEXUS_WORKSPACE`. Cada script tiene un máximo de 20 segundos y salida acotada. Los artefactos se consultan en los archivos del Nexbot.

El chat general utiliza instrucciones y recursos; para ejecutar scripts ofrece continuar con un Nexbot. Importar o leer una skill no ejecuta sus archivos. El campo `allowed-tools` se conserva como información y no concede permisos.

## Arquitectura y contratos

- `nas.adk.skills` define el formato, importadores, exportación, validación y carga progresiva. `SkillStore` aporta el catálogo y los paquetes; `SkillExecutor` solicita la ejecución al host. El ADK también proporciona el creador reutilizable y la evaluación de resultados.
- Nexus aporta los adaptadores del BFF, autenticación, permisos, almacenamiento en PostgreSQL, biblioteca, borradores, versiones y galería. El sidecar obtiene exclusivamente los paquetes fijados para el run mediante su token firmado.
- Cada run conserva la configuración resuelta, el modelo efectivo y las versiones de skills. Los checkpoints incluyen eventos y estado de sesión. Una reanudación conserva esas versiones aunque se publique otra mientras espera aprobación.
- Los contratos TypeScript y JSON Schema se generan desde los modelos Python. Desde el entorno de nas-adk: `python ../nexus/scripts/generate-skills-contracts.py`; añade `--check` para comprobar que están actualizados.
- API: `/api/skills` gestiona biblioteca, importación, versiones, copia y exportación; `/api/skill-drafts` gestiona borradores, conversación y pruebas; `/api/bots` configura Nexbots y sus skills. Conocimiento, memoria y disparadores cuelgan de cada bot. El disparador de encadenado es `bot_completed`.

## Actualizar una instalación

Actualiza y despliega juntos Nexus, nas-adk, el sidecar y la imagen de Nexbot. Detén el planificador y los procesos anteriores antes de aplicar la migración. El arranque habitual aplica `scripts/migrate.mjs`.

La transición elegida retira los antiguos perfiles de Agentes y sus datos exclusivos, sin convertirlos. Conserva cuentas, credenciales, historiales, Nexbots, sus volúmenes y memoria personal. Las ejecuciones antiguas ligadas a agentes o bots se interrumpen; las conversaciones siguen siendo legibles. Los antiguos entornos de Agentes quedan pendientes de retirada por sandboxd, con reintento en el siguiente arranque si no está disponible. Las páginas de Agentes redirigen a Skills y sus API responden `410`.

No se incluyen repositorios privados, formatos específicos de otras plataformas, actualizaciones automáticas ni un entorno temporal de scripts para el chat general.

## Verificación reproducible

Las pruebas de formato, carga, checkpoints y callbacks viven en nas-adk. Nexus incluye pruebas de política, configuración, sidecar y ejecución de scripts.

El recorrido de Docker usa exclusivamente cuentas y modelos simulados de prueba, además de un contenedor real para ejecutar el script:

```bash
docker build -f docker/nexbot.Dockerfile -t nexus-nexbot:skills-check services/nexbot
docker compose -f scripts/skills-e2e/compose.yml up -d --build
services/agent/.venv/bin/python scripts/skills-e2e/smoke.py
docker compose -f scripts/skills-e2e/compose.yml down -v
```

La prueba de migración exige una base desechable cuyo nombre comience por `skills_migration_`; se ejecuta con `SKILLS_MIGRATION_TEST_URL=… node scripts/skills-e2e/migration.mjs`.
