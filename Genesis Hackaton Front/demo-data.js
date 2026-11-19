"use strict";

const DEMO = {
  episode_id: "demo-001",
  schema_version: "demo-1",
  base_currency: "KZT",
  period_start: "2026-10-01T00:00:00+05:00",
  period_end: "2026-10-31T23:59:59+05:00",
  timezone: "Asia/Almaty",
  currency_digits: { KZT: 2, USD: 2 },
  task: "Проверьте проводки и связанные документы за октябрь. Если найдёте расхождение, зафиксируйте его и приложите ID доказательств.",
  policy: {
    fx_date: "Дата платежа по времени эпизода",
    accounting_period: "Границы периода включительно по времени эпизода",
    rounding: "До минимальной единицы валюты, половина от нуля"
  },
  tables: {
    ledger: {
      label: "Проводки", id: "row_id",
      columns: [["row_id", "ID"], ["timestamp", "Дата"], ["account", "Счёт учёта"],
        ["debit_minor", "Дебет"], ["credit_minor", "Кредит"], ["invoice_id", "Счёт"], ["payment_id", "Платёж"]],
      rows: [
        { row_id: "L-104", timestamp: "2026-10-03T09:15:00+05:00", account: "Расходы", debit_minor: 12500000, credit_minor: 0, currency: "KZT", entity_id: "ENT-01", invoice_id: "INV-019", payment_id: null },
        { row_id: "L-105", timestamp: "2026-10-03T09:15:00+05:00", account: "Кредиторская задолженность", debit_minor: 0, credit_minor: 12500000, currency: "KZT", entity_id: "ENT-01", invoice_id: "INV-019", payment_id: null },
        { row_id: "L-118", timestamp: "2026-10-10T12:00:00+05:00", account: "Кредиторская задолженность", debit_minor: 5000000, credit_minor: 0, currency: "KZT", entity_id: "ENT-01", invoice_id: "INV-019", payment_id: "PAY-041" },
        { row_id: "L-119", timestamp: "2026-10-10T12:00:00+05:00", account: "Денежные средства", debit_minor: 0, credit_minor: 5000000, currency: "KZT", entity_id: "ENT-01", invoice_id: "INV-019", payment_id: "PAY-041" },
        { row_id: "L-122", timestamp: "2026-10-13T15:30:00+05:00", account: "Кредиторская задолженность", debit_minor: 7500000, credit_minor: 0, currency: "KZT", entity_id: "ENT-01", invoice_id: "INV-019", payment_id: "PAY-042" },
        { row_id: "L-123", timestamp: "2026-10-13T15:30:00+05:00", account: "Денежные средства", debit_minor: 0, credit_minor: 7500000, currency: "KZT", entity_id: "ENT-01", invoice_id: "INV-019", payment_id: "PAY-042" },
        { row_id: "L-136", timestamp: "2026-10-21T10:30:00+05:00", account: "Расходы", debit_minor: 12500000, credit_minor: 0, currency: "KZT", entity_id: "ENT-01", invoice_id: "INV-019", payment_id: null },
        { row_id: "L-137", timestamp: "2026-10-21T10:30:00+05:00", account: "Кредиторская задолженность", debit_minor: 0, credit_minor: 12500000, currency: "KZT", entity_id: "ENT-01", invoice_id: "INV-019", payment_id: null }
      ]
    },
    invoices: {
      label: "Счета", id: "invoice_id",
      columns: [["invoice_id", "ID"], ["doc_id", "Документ"], ["issued_at", "Дата"], ["total_minor", "Сумма"]],
      rows: [
        { doc_id: "DOC-I019", invoice_id: "INV-019", entity_id: "ENT-01", issued_at: "2026-10-03T09:00:00+05:00", due_at: "2026-10-25T18:00:00+05:00", currency: "KZT", total_minor: 12500000, line_items: [{ description: "Техническое обслуживание", amount_minor: 12500000 }] }
      ]
    },
    payments: {
      label: "Платежи", id: "payment_id",
      columns: [["payment_id", "ID"], ["doc_id", "Документ"], ["timestamp", "Дата"], ["amount_minor", "Сумма"], ["invoice_refs", "Счета"]],
      rows: [
        { doc_id: "DOC-P041", payment_id: "PAY-041", timestamp: "2026-10-10T12:00:00+05:00", currency: "KZT", amount_minor: 5000000, invoice_refs: ["INV-019"] },
        { doc_id: "DOC-P042", payment_id: "PAY-042", timestamp: "2026-10-13T15:30:00+05:00", currency: "KZT", amount_minor: 7500000, invoice_refs: ["INV-019"] }
      ]
    },
    fx: {
      label: "Курсы FX", id: null,
      columns: [["date", "Дата"], ["source_currency", "Из"], ["target_currency", "В"], ["rate", "Курс"]],
      rows: [
        { date: "2026-10-10", source_currency: "USD", target_currency: "KZT", rate: "492.1250" },
        { date: "2026-10-13", source_currency: "USD", target_currency: "KZT", rate: "493.2100" }
      ]
    }
  },
  findingTypes: {
    duplicate_invoice: "Дублирование счёта",
    payment_allocation: "Распределение платежа",
    fx_conversion: "Дата или курс конвертации",
    period_cutoff: "Отчётный период"
  }
};
