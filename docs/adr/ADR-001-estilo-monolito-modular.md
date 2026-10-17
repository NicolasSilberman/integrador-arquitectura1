# ADR-001: Estilo arquitectónico: monolito modular

**Estado:** Aceptada

## Contexto

El sistema administra 6 consorcios con unas 150 unidades. Lo mantiene un programador freelance que viene cuando hay problemas, se despliega en un hosting barato y no hay nadie de guardia. Los NFR estrella son **consistencia** (nunca cobrar dos veces la misma expensa y siempre imputar a la unidad correcta) y **simplicidad**. La carga es baja: decenas de usuarios simultáneos en el pico y una conciliación por día.

## Decisión

Vamos a construir un **monolito modular**: un solo desplegable, dividido en los módulos Padrón, Liquidación y Cobranzas, que se comunican por interfaces explícitas. Cada módulo es dueño de sus datos.

## Alternativas

La comparación completa está en la matriz de Pugh (documento de arquitectura, sección 5).

| Alternativa | Por qué se descartó |
|---|---|
| Monolito en capas | Cumple, pero sin fronteras entre módulos el código tiende a mezclarse. El modular cuesta lo mismo de operar y mejora la mantenibilidad |
| Microservicios | La imputación de un pago dejaría de ser una sola transacción y pasaría a cruzar servicios. Suma contenedores y despliegues para un freelancer, sin un requisito de escala que lo justifique |
| Orientado a eventos | Agrega un broker que operar y consistencia eventual. Su ventaja en recuperación ante fallas del banco se puede lograr dentro del monolito (ADR-004) |

## Consecuencias

- (+) Una transacción alcanza para imputar un pago: no hay estados intermedios entre servicios.
- (+) Un solo artefacto que desplegar, levantar y depurar.
- (+) Si en el futuro un módulo necesitara separarse, ya tiene frontera y datos propios.
- (−) Escala solo en vertical. Se acepta: la escala del escenario es fija y chica.
- (−) Las fronteras entre módulos dependen de la disciplina del equipo, porque el lenguaje no las impone.

## NFRs

- **Favorece:** consistencia, simplicidad, costo y mantenibilidad.
- **Perjudica:** escalabilidad (que no es un objetivo del escenario).
