# F13 · Preparación para publicar

> Se llena por fase, al cerrar G5–G7. **Nada se publica con una casilla sin evidencia.**
> Hay un despliegue vivo con datos de prueba (`docs/producto/demo-datos-y-despliegue.md`): una publicación de F13 toca ese entorno.

## Checklist por fase
- [ ] G4 (plan aprobado), G5 (verificación), G6 (review), G7 (cierre) en PASS en `../STATUS.md`
- [ ] Migraciones: aditivas, probadas sobre copia de datos con tenants individuales y con oficinas, con `verify/*.sql` en PASS
- [ ] Respaldo previo comprobado (script `db:backup` existe: `apps/api/package.json`; restauración: según `docs/producto/README.md` no hay script de restauración → verificar)
- [ ] Regresión del perfil gratuito individual en PASS
- [ ] Rollback descrito en el plan y probado cuando sea posible
- [ ] Web y móvil compatibles entre sí con las versiones desplegadas (el móvil no se actualiza al instante)
- [ ] Documentación de producto (`docs/producto/…`) actualizada

## Fases listas para publicar
_(ninguna)_
