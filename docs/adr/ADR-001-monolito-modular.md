# ADR-001: Monolito modular con una única base de datos

- **Estado:** Aceptado
- **Fecha:** 15/10/2026

## Contexto
El sistema liquida expensas de 6 consorcios (~150 unidades). Lo mantiene un programador freelance que sólo interviene cuando hay problemas, el hosting debe ser barato y **no hay guardia**: si algo falla de noche se arregla al día siguiente. Los NFR estrella son **consistencia** y **simplicidad**. La carga es mínima (decenas de usuarios, una conciliación por día).

## Decisión
Un único proceso desplegable (API Node.js) organizado en **módulos con límites claros** (`padron`, `liquidaciones`, `cobranzas`) sobre **una sola base PostgreSQL**. Cada módulo es dueño de sus tablas y expone sólo su `index.js`; ningún módulo lee las tablas de otro. La capa de rutas compone los módulos.

## Alternativas consideradas
Ver matriz de Pugh en `arquitectura.md` (referencia: monolito en capas).

| Alternativa | Por qué no |
|---|---|
| Monolito en capas clásico | Funciona, pero sin fronteras explícitas el código se enreda; el modular cuesta casi lo mismo y deja la puerta abierta. |
| Microservicios | Una transacción de imputación pasaría a ser distribuida (sagas, consistencia eventual): lo contrario del NFR estrella. Multiplica contenedores, despliegues y puntos de falla para un freelancer sin guardia. |
| Orientado a eventos (broker) | Agrega un broker que operar y consistencia eventual, sin ningún requisito de escala que lo justifique. |

## Consecuencias
- (+) Una transacción ACID cubre todo el caso de uso; no hay estados intermedios entre servicios.
- (+) Un solo artefacto que desplegar, monitorear y depurar.
- (+) Si algún módulo creciera, ya tiene frontera y datos propios: se podría extraer.
- (−) Escala vertical (un solo proceso). Aceptado: el escenario son ~150 unidades.
- (−) Las fronteras entre módulos se respetan por disciplina (no hay compilador que las imponga). Mitigación: acceso sólo vía `index.js`, revisable en code review.

## NFR relacionados
Consistencia, simplicidad operativa, costo de infraestructura, time-to-market.
