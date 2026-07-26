import { isSameDay } from 'date-fns'

/**
 * Decide la rotación por día calendario en la zona local del dispositivo.
 * Una ventana fija de 24 horas se rompe al cruzar DST y trata mensajes de ayer
 * cerca de medianoche como si fueran de hoy.
 */
export function shouldRotateConversation(lastMessageAt: number | null, now: number): boolean {
  if (lastMessageAt == null) return false
  return !isSameDay(new Date(lastMessageAt), new Date(now))
}
