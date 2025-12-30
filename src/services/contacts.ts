import prisma from '../db/client';
import { Prisma, PrismaClient } from '../generated/prisma/client';
import { normalizeEmailOptional } from '../utils/normalizeEmail';
import { normalizePhoneOptional } from '../utils/normalizePhone';

type DbClient = PrismaClient | Prisma.TransactionClient;

function computeContactName(name?: string, email?: string, phone?: string): string {
  const n = (name && name.trim()) || '';
  if (n) return n.slice(0, 255);
  const e = (email && email.trim()) || '';
  if (e) return e.slice(0, 255);
  const p = (phone && phone.trim()) || '';
  if (p) return p.slice(0, 255);
  return 'Unknown';
}

function isUniqueError(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as any).code === 'P2002');
}

export type FindOrCreateContactInput = {
  name?: string | null;
  email?: unknown;
  phone?: unknown;
  notes?: string | null;
};

/**
 * Find or create a Contact within a project using normalized email/phone.
 *
 * Lookup priority:
 *  1) emailNormalized
 *  2) phoneNormalized
 *
 * If a contact is found, missing raw/normalized fields are backfilled.
 * Safe for concurrent requests: on unique violations it re-fetches the contact.
 */
export async function findOrCreateContact(
  projectId: number,
  input: FindOrCreateContactInput,
  db: DbClient = prisma
) {
  const rawName = (input.name ?? undefined) ? String(input.name).trim() : undefined;
  const emailNorm = normalizeEmailOptional(input.email);
  const phoneNorm = normalizePhoneOptional(input.phone);

  const rawEmail = input.email != null ? String(input.email).trim() : undefined;
  const rawPhone = input.phone != null ? String(input.phone).trim() : undefined;

  // Try find by emailNormalized first
  let contact =
    emailNorm
      ? await db.contact.findFirst({ where: { projectId, emailNormalized: emailNorm } })
      : null;

  if (!contact && phoneNorm) {
    contact = await db.contact.findFirst({ where: { projectId, phoneNormalized: phoneNorm } });
  }

  const desiredName = computeContactName(rawName, rawEmail, rawPhone);
  const desiredNotes = input.notes ?? undefined;

  if (contact) {
    // Backfill missing fields, but avoid overwriting existing richer data.
    const data: any = {};

    if (rawName && (!contact.name || contact.name === 'Unknown')) data.name = rawName.slice(0, 255);
    if (!contact.name) data.name = desiredName;

    if (rawEmail && !contact.email) data.email = rawEmail.slice(0, 255);
    if (rawPhone && !contact.phone) data.phone = rawPhone.slice(0, 50);

    if (emailNorm && !contact.emailNormalized) data.emailNormalized = emailNorm;
    if (phoneNorm && !contact.phoneNormalized) data.phoneNormalized = phoneNorm;

    if (desiredNotes && !contact.notes) data.notes = String(desiredNotes).slice(0, 2000);

    if (Object.keys(data).length) {
      contact = await db.contact.update({
        where: { id_projectId: { id: contact.id, projectId } },
        data,
      });
    }

    return contact;
  }

  // Create new contact
  try {
    return await db.contact.create({
      data: {
        projectId,
        name: desiredName,
        email: rawEmail ? rawEmail.slice(0, 255) : null,
        phone: rawPhone ? rawPhone.slice(0, 50) : null,
        emailNormalized: emailNorm || null,
        phoneNormalized: phoneNorm || null,
        notes: desiredNotes ? String(desiredNotes).slice(0, 2000) : null,
      },
    });
  } catch (err) {
    // If another request created the same contact concurrently, fetch it and continue.
    if (isUniqueError(err) && (emailNorm || phoneNorm)) {
      const existing =
        emailNorm
          ? await db.contact.findFirst({ where: { projectId, emailNormalized: emailNorm } })
          : null;
      if (existing) return existing;

      const existingByPhone =
        phoneNorm
          ? await db.contact.findFirst({ where: { projectId, phoneNormalized: phoneNorm } })
          : null;
      if (existingByPhone) return existingByPhone;
    }

    throw err;
  }
}
