import express from 'express';
import { z, ZodError } from 'zod';
import prisma from '../db/client';
import { requireAuth } from '../middleware/auth';
import { AuthRequest } from '../types/auth';
import { DEFAULT_PROJECT_CONFIG } from './projects';

const router = express.Router();

const transactionTypeEnum = z.enum(['income', 'expense']);

const createTransactionSchema = z.object({
  type: transactionTypeEnum,
  amount: z.number().positive('amount must be greater than 0'),
  currency: z.string().max(10).optional(),
  category: z.string().max(100).optional(),
  description: z.string().max(2000).optional(),
  contactId: z.number().int().positive().optional(),
  caseId: z.number().int().positive().optional(),
  happenedAt: z.string().datetime().optional(), // ISO string (e.g. 2025-01-01T12:00:00Z)
});

const updateTransactionSchema = z
  .object({
    type: transactionTypeEnum.optional(),
    amount: z.number().positive().optional(),
    currency: z.string().max(10).optional(),
    category: z.string().max(100).optional(),
    description: z.string().max(2000).optional(),
    contactId: z.number().int().positive().optional(),
    caseId: z.number().int().positive().optional(),
    happenedAt: z.string().datetime().optional(),
  })
  .refine(
    (data) =>
      data.type !== undefined ||
      data.amount !== undefined ||
      data.currency !== undefined ||
      data.category !== undefined ||
      data.description !== undefined ||
      data.contactId !== undefined ||
      data.caseId !== undefined ||
      data.happenedAt !== undefined,
    {
      message: 'At least one field must be provided',
      path: ['type'],
    }
  );

const listTransactionsQuerySchema = z.object({
  type: transactionTypeEnum.optional(),
  category: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  minAmount: z.string().optional(),
  maxAmount: z.string().optional(),
  caseId: z.string().optional(),
});

type TransactionCategoryType = 'income' | 'expense';

type TransactionCategoryConfig = {
  code?: string;
  type?: TransactionCategoryType;
};

type TransactionTypeMap = Record<string, TransactionCategoryType>;

/**
 * Build a map categoryCode -> 'income' | 'expense' for a given project.
 * Falls back to DEFAULT_PROJECT_CONFIG.transactionCategories when project.config is empty.
 */
async function getProjectTransactionCategoryTypeMap(projectId: number): Promise<TransactionTypeMap> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  const config = (project?.config as any) || {};
  const rawCategories: TransactionCategoryConfig[] =
    (Array.isArray(config.transactionCategories) && config.transactionCategories.length > 0
      ? config.transactionCategories
      : DEFAULT_PROJECT_CONFIG.transactionCategories) ?? [];

  const map: TransactionTypeMap = {};

  for (const item of rawCategories) {
    if (!item || !item.code) continue;
    if (item.type !== 'income' && item.type !== 'expense') continue;
    map[item.code] = item.type;
  }

  return map;
}

/**
 * Decide whether a transaction is effectively income or expense.
 * Priority:
 *   1) transaction.type field (source of truth when explicitly set),
 *   2) category type from project config (fallback when tx.type is missing/legacy).
 */
function getEffectiveTransactionType(
  tx: { type: string | null; category: string | null },
  categoryTypeMap: TransactionTypeMap
): TransactionCategoryType | null {
  if (tx.type === 'income' || tx.type === 'expense') {
    return tx.type;
  }

  const categoryCode = tx.category ?? undefined;
  if (categoryCode && categoryTypeMap[categoryCode]) {
    return categoryTypeMap[categoryCode];
  }

  return null;
}




// GET /transactions - list transactions for current project with filters
router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const projectId = req.user.projectId;
    const query = listTransactionsQuerySchema.parse(req.query);

    const where: any = { projectId };

    // NOTE:
    // We intentionally do NOT filter by query.type at the database level anymore.
    // The "type" of a transaction is now primarily determined by its category
    // in project.config.transactionCategories (income/expense). We first load
    // all matching transactions for the project and then apply the type filter
    // in memory using the effective type (category -> income/expense fallback
    // to transaction.type).

    if (query.category) {
      where.category = query.category;
    }

    if (query.dateFrom || query.dateTo) {
      const happenedAt: any = {};
      if (query.dateFrom) {
        const dFrom = new Date(query.dateFrom);
        if (Number.isNaN(dFrom.getTime())) {
          return res.status(400).json({ error: 'Invalid dateFrom' });
        }
        happenedAt.gte = dFrom;
      }
      if (query.dateTo) {
        const dTo = new Date(query.dateTo);
        if (Number.isNaN(dTo.getTime())) {
          return res.status(400).json({ error: 'Invalid dateTo' });
        }
        happenedAt.lte = dTo;
      }
      where.happenedAt = happenedAt;
    }

    if (query.caseId) {
      const cid = Number(query.caseId);
      if (Number.isNaN(cid)) {
        return res.status(400).json({ error: 'Invalid caseId' });
      }
      where.caseId = cid;
    }

    if (query.minAmount || query.maxAmount) {
      const amount: any = {};
      if (query.minAmount) {
        const min = Number(query.minAmount);
        if (Number.isNaN(min)) {
          return res.status(400).json({ error: 'Invalid minAmount' });
        }
        amount.gte = min;
      }
      if (query.maxAmount) {
        const max = Number(query.maxAmount);
        if (Number.isNaN(max)) {
          return res.status(400).json({ error: 'Invalid maxAmount' });
        }
        amount.lte = max;
      }
      where.amount = amount;
    }

    const [transactions, categoryTypeMap] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy: { happenedAt: 'desc' },
        include: {
          contact: true,
          case: true,
        },
      }),
      getProjectTransactionCategoryTypeMap(projectId),
    ]);

    let filtered = transactions;

    if (query.type) {
      filtered = transactions.filter((tx) => {
        const effectiveType = getEffectiveTransactionType(
          {
            type: (tx.type as string | null) ?? null,
            category: (tx.category as string | null) ?? null,
          },
          categoryTypeMap
        );
        return effectiveType === query.type;
      });
    }

    return res.json(filtered);
  } catch (error: any) {
    console.error('Error fetching transactions', error);

    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.errors,
      });
    }

    return res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});



// GET /transactions/summary - simple totals for income/expense in period
router.get('/summary', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const projectId = req.user.projectId;
    const query = listTransactionsQuerySchema.parse(req.query);

    const baseWhere: any = { projectId };

    if (query.category) {
      baseWhere.category = query.category;
    }

    if (query.dateFrom || query.dateTo) {
      const happenedAt: any = {};
      if (query.dateFrom) {
        const dFrom = new Date(query.dateFrom);
        if (Number.isNaN(dFrom.getTime())) {
          return res.status(400).json({ error: 'Invalid dateFrom' });
        }
        happenedAt.gte = dFrom;
      }
      if (query.dateTo) {
        const dTo = new Date(query.dateTo);
        if (Number.isNaN(dTo.getTime())) {
          return res.status(400).json({ error: 'Invalid dateTo' });
        }
        happenedAt.lte = dTo;
      }
      baseWhere.happenedAt = happenedAt;
    }

    const [transactions, categoryTypeMap] = await Promise.all([
      prisma.transaction.findMany({
        where: baseWhere,
      }),
      getProjectTransactionCategoryTypeMap(projectId),
    ]);

    let totalIncome = 0;
    let totalExpense = 0;

    for (const tx of transactions) {
      const effectiveType = getEffectiveTransactionType(
        {
          type: (tx.type as string | null) ?? null,
          category: (tx.category as string | null) ?? null,
        },
        categoryTypeMap
      );

      if (!effectiveType) continue;
      if (query.type && effectiveType !== query.type) continue;

      const amount = Number(tx.amount || 0);
      if (!Number.isFinite(amount)) continue;

      if (effectiveType === 'income') {
        totalIncome += amount;
      } else if (effectiveType === 'expense') {
        totalExpense += amount;
      }
    }

    const net = totalIncome - totalExpense;

    return res.json({
      totalIncome,
      totalExpense,
      net,
    });
  } catch (error: any) {
    console.error('Error fetching transaction summary', error);

    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.errors,
      });
    }

    return res.status(500).json({ error: 'Failed to fetch transaction summary' });
  }
});


// POST /transactions - create a transaction
router.post('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const projectId = req.user.projectId;
    const parsed = createTransactionSchema.parse(req.body);

    let contactId: number | undefined = parsed.contactId;
    let caseId: number | undefined = parsed.caseId;

    if (contactId !== undefined) {
      const contact = await prisma.contact.findUnique({
        where: {
          id_projectId: {
            id: contactId,
            projectId,
          },
        },
      });

      if (!contact) {
        return res.status(404).json({ error: 'Contact not found for this project' });
      }
    }

    if (caseId !== undefined) {
      const foundCase = await prisma.case.findUnique({
        where: {
          id_projectId: {
            id: caseId,
            projectId,
          },
        },
      });

      if (!foundCase) {
        return res.status(404).json({ error: 'Case not found for this project' });
      }
    }

    let happenedAt: Date | undefined;
    if (parsed.happenedAt) {
      const d = new Date(parsed.happenedAt);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ error: 'Invalid happenedAt' });
      }
      happenedAt = d;
    }

    const created = await prisma.transaction.create({
      data: {
        projectId,
        contactId: contactId ?? null,
        caseId: caseId ?? null,
        type: parsed.type,
        amount: parsed.amount,
        currency: parsed.currency || 'UAH',
        category: parsed.category || null,
        description: parsed.description || null,
        happenedAt: happenedAt,
      },
      include: {
        contact: true,
        case: true,
      },
    });

    return res.status(201).json(created);
  } catch (error: any) {
    console.error('Error creating transaction', error);

    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.errors,
      });
    }

    return res.status(500).json({ error: 'Failed to create transaction' });
  }
});

// PATCH /transactions/:id - update a transaction
router.patch('/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const projectId = req.user.projectId;
    const id = Number(req.params.id);

    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid transaction id' });
    }

    const data = updateTransactionSchema.parse(req.body);

    let contactId: number | undefined = data.contactId;
    let caseId: number | undefined = data.caseId;

    if (contactId !== undefined) {
      const contact = await prisma.contact.findUnique({
        where: {
          id_projectId: {
            id: contactId,
            projectId,
          },
        },
      });

      if (!contact) {
        return res.status(404).json({ error: 'Contact not found for this project' });
      }
    }

    if (caseId !== undefined) {
      const foundCase = await prisma.case.findUnique({
        where: {
          id: caseId,
          projectId,
        },
      });

      // NOTE: case has unique constraint on [id, projectId]; but here we can use where:id_projectId too if needed
      if (!foundCase) {
        return res.status(404).json({ error: 'Case not found for this project' });
      }
    }

    let happenedAt: Date | undefined;
    if (data.happenedAt) {
      const d = new Date(data.happenedAt);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ error: 'Invalid happenedAt' });
      }
      happenedAt = d;
    }

    const updated = await prisma.transaction.update({
      where: {
        id,
      },
      data: {
        type: data.type,
        amount: data.amount,
        currency: data.currency,
        category: data.category,
        description: data.description,
        contactId: contactId ?? undefined,
        caseId: caseId ?? undefined,
        happenedAt: happenedAt ?? undefined,
      },
      include: {
        contact: true,
        case: true,
      },
    });

    return res.json(updated);
  } catch (error: any) {
    console.error('Error updating transaction', error);

    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.errors,
      });
    }

    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    return res.status(500).json({ error: 'Failed to update transaction' });
  }
});

// DELETE /transactions/:id - delete a transaction
router.delete('/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const projectId = req.user.projectId;
    const id = Number(req.params.id);

    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid transaction id' });
    }

    await prisma.transaction.delete({
      where: {
        id,
      },
    });

    return res.status(204).send();
  } catch (error: any) {
    console.error('Error deleting transaction', error);

    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    return res.status(500).json({ error: 'Failed to delete transaction' });
  }
});

export default router;
