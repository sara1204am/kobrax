/**
 * F14 · F5 (H-11, D-7): los interruptores EXTERNOS de la plataforma. Los controla quien opera el servidor (variables de entorno del proceso), no hay API ni
 * pantalla que los cambie. Se leen en cada petición y arrancan APAGADOS: sin `PLATFORM_ACCESS_ENABLED=true` ningún token de plataforma pasa, aunque
 * las credenciales sean válidas; sin `SUPPORT_WRITE_ENABLED=true` una sesión de soporte no puede escribir nada.
 */
export const platformAccessEnabled = (): boolean => process.env.PLATFORM_ACCESS_ENABLED === 'true';
export const supportWriteEnabled = (): boolean => process.env.SUPPORT_WRITE_ENABLED === 'true';
