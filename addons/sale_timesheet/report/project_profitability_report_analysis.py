# -*- coding: utf-8 -*-
# Part of Odoo. See LICENSE file for full copyright and licensing details.

from odoo import fields, models, tools


class ProfitabilityAnalysis(models.Model):

    _name = "project.profitability.report"
    _description = "Project Profitability Analysis"
    _order = 'project_id, sale_line_id'
    _auto = False

    analytic_account_id = fields.Many2one('account.analytic.account', string='Analytic Account', readonly=True)
    project_id = fields.Many2one('project.project', string='Project', readonly=True)
    currency_id = fields.Many2one('res.currency', string='Project Currency', readonly=True)
    company_id = fields.Many2one('res.company', string='Project Company', readonly=True)
    user_id = fields.Many2one('res.users', string='Project Manager', readonly=True)
    partner_id = fields.Many2one('res.partner', string='Customer', readonly=True)
    # cost
    timesheet_unit_amount = fields.Float("Timesheet Unit Amount", digits=(16, 2), readonly=True, group_operator="sum")
    timesheet_cost = fields.Float("Timesheet Cost", digits=(16, 2), readonly=True, group_operator="sum")
    expense_cost = fields.Float("Other Cost", digits=(16, 2), readonly=True, group_operator="sum")
    # sale revenue
    order_confirmation_date = fields.Datetime('Sales Order Confirmation Date', readonly=True)
    sale_line_id = fields.Many2one('sale.order.line', string='Sale Order Line', readonly=True)
    sale_order_id = fields.Many2one('sale.order', string='Sale Order', readonly=True)
    product_id = fields.Many2one('product.product', string='Product', readonly=True)

    amount_untaxed_to_invoice = fields.Float("Untaxed Amount To Invoice", digits=(16, 2), readonly=True, group_operator="sum")
    amount_untaxed_invoiced = fields.Float("Untaxed Amount Invoiced", digits=(16, 2), readonly=True, group_operator="sum")
    expense_amount_untaxed_to_invoice = fields.Float("Untaxed Amount to Re-invoiced", digits=(16, 2), readonly=True, group_operator="sum")
    expense_amount_untaxed_invoiced = fields.Float("Untaxed Re-invoiced Amount", digits=(16, 2), readonly=True, group_operator="sum")

    def init(self):
        tools.drop_view_if_exists(self._cr, self._table)
        query = """
            CREATE VIEW %s AS (
                WITH currency_rate as (%s)
                SELECT
                    ROW_NUMBER() OVER (ORDER BY P.id, SOL.id) AS id,
                    P.id AS project_id,
                    P.user_id AS user_id,
                    SOL.id AS sale_line_id,
                    P.analytic_account_id AS analytic_account_id,
                    P.partner_id AS partner_id,
                    C.id AS company_id,
                    C.currency_id AS currency_id,
                    S.id AS sale_order_id,
                    S.date_order AS order_confirmation_date,
                    SOL.product_id AS product_id,
                    SOL.qty_delivered_method AS sale_qty_delivered_method,
                    CASE
                       WHEN SOL.qty_delivered_method = 'analytic' THEN (SOL.price_reduce / COALESCE(CR.rate, 1.0)) * SOL.qty_to_invoice
                       ELSE 0.0
                    END AS expense_amount_untaxed_to_invoice,
                    CASE
                       WHEN SOL.qty_delivered_method = 'analytic' AND SOL.invoice_status != 'no'
                       THEN
                            CASE
                                WHEN T.expense_policy = 'sales_price'
                                THEN (SOL.price_reduce / COALESCE(CR.rate, 1.0)) * SOL.qty_invoiced
                                ELSE -COST_SUMMARY.expense_cost
                            END
                       ELSE 0.0
                    END AS expense_amount_untaxed_invoiced,
                    CASE
                       WHEN SOL.qty_delivered_method = 'timesheet' THEN (SOL.price_reduce / COALESCE(CR.rate, 1.0)) * SOL.qty_to_invoice
                       ELSE 0.0
                    END AS amount_untaxed_to_invoice,
                    CASE
                       WHEN SOL.qty_delivered_method = 'timesheet' THEN (SOL.price_reduce / COALESCE(CR.rate, 1.0)) * SOL.qty_invoiced
                       ELSE 0.0
                    END AS amount_untaxed_invoiced,
                    COST_SUMMARY.timesheet_unit_amount AS timesheet_unit_amount,
                    COST_SUMMARY.timesheet_cost AS timesheet_cost,
                    COST_SUMMARY.expense_cost AS expense_cost
                FROM project_project P
                    JOIN res_company C ON C.id = P.company_id
                    LEFT JOIN (
                        SELECT
                            project_id,
                            analytic_account_id,
                            sale_line_id,
                            SUM(timesheet_unit_amount) AS timesheet_unit_amount,
                            SUM(timesheet_cost) AS timesheet_cost,
                            SUM(expense_cost) AS expense_cost
                        FROM (
                            SELECT
                                P.id AS project_id,
                                P.analytic_account_id AS analytic_account_id,
                                TS.so_line AS sale_line_id,
                                SUM(TS.unit_amount) AS timesheet_unit_amount,
                                SUM(TS.amount) AS timesheet_cost,
                                0.0 AS expense_cost
                            FROM account_analytic_line TS, project_project P
                            WHERE TS.project_id IS NOT NULL AND P.id = TS.project_id AND P.active = 't' AND P.allow_timesheets = 't'
                            GROUP BY P.id, TS.so_line

                            UNION

                            SELECT
                                P.id AS project_id,
                                P.analytic_account_id AS analytic_account_id,
                                AAL.so_line AS sale_line_id,
                                0.0 AS timesheet_unit_amount,
                                0.0 AS timesheet_cost,
                                SUM(AAL.amount) AS expense_cost
                            FROM project_project P
                                LEFT JOIN account_analytic_account AA ON P.analytic_account_id = AA.id
                                LEFT JOIN account_analytic_line AAL ON AAL.account_id = AA.id
                            WHERE AAL.amount < 0.0 AND AAL.project_id IS NULL AND P.active = 't' AND P.allow_timesheets = 't'
                            GROUP BY P.id, AA.id, AAL.so_line

                            UNION

                            SELECT
                                P.id AS project_id,
                                P.analytic_account_id AS analytic_account_id,
                                SOL.id AS sale_line_id,
                                0.0 AS timesheet_unit_amount,
                                0.0 AS timesheet_cost,
                                0.0 AS expense_cost
                            FROM sale_order_line SOL
                                INNER JOIN project_project P ON SOL.project_id = P.id
                            WHERE P.active = 't' AND P.allow_timesheets = 't'

                            UNION

                            SELECT
                                P.id AS project_id,
                                P.analytic_account_id AS analytic_account_id,
                                SOL.id AS sale_line_id,
                                0.0 AS timesheet_unit_amount,
                                0.0 AS timesheet_cost,
                                0.0 AS expense_cost
                            FROM sale_order_line SOL
                                INNER JOIN project_task T ON SOL.task_id = T.id
                                INNER JOIN project_project P ON P.id = T.project_id
                            WHERE P.active = 't' AND P.allow_timesheets = 't'
                        ) SUB_COST_SUMMARY
                        GROUP BY project_id, analytic_account_id, sale_line_id
                    ) COST_SUMMARY ON COST_SUMMARY.project_id = P.id
                    LEFT JOIN sale_order_line SOL ON COST_SUMMARY.sale_line_id = SOL.id
                    LEFT JOIN sale_order S ON SOL.order_id = S.id
                    LEFT JOIN product_product PP on (SOL.product_id=PP.id)
                    LEFT JOIN product_template T on (PP.product_tmpl_id=T.id)
                    LEFT JOIN currency_rate CR ON (CR.currency_id = SOL.currency_id
                        AND CR.currency_id != C.currency_id
                        AND CR.company_id = SOL.company_id
                        AND CR.date_start <= COALESCE(S.date_order, now())
                        AND (CR.date_end IS NULL OR cr.date_end > COALESCE(S.date_order, now())))
                    WHERE P.active = 't' AND P.analytic_account_id IS NOT NULL
            )
        """ % (self._table, self.env['res.currency']._select_companies_rates())
        self._cr.execute(query)
