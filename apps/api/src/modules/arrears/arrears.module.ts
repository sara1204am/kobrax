import { Module } from '@nestjs/common';
import { ArrearsJobService } from './arrears-job.service';

/**
 * El ciclo de vida de la mora, como tarea de sistema.
 *
 * No expone endpoints a propósito: no hay nada que un humano tenga que pedirle. Los tres botones que
 * había —recalcular mora, generar casos, cerrar el caso— eran consecuencias del dato disfrazadas de
 * decisiones, y este módulo las convierte de vuelta en consecuencias.
 */
@Module({ providers: [ArrearsJobService], exports: [ArrearsJobService] })
export class ArrearsModule {}
