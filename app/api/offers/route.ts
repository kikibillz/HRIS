import { randomBytes, createHash } from "node:crypto";
import { currentUser, requireUser, digest } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertHiringApproval } from "@/lib/recruiting";
import { validDate } from "@/lib/leave-policy";
import { audit } from "@/lib/tenant";
export const dynamic = "force-dynamic";
export async function GET() {
  const user = await currentUser();
  if (!user)
    return Response.json({ error: "Please sign in." }, { status: 401 });
  if (user.access !== "admin")
    return Response.json(
      { error: "Administrator access required." },
      { status: 403 },
    );
  const offers = db
    .prepare(
      "SELECT o.*,CASE WHEN o.status='Issued' AND o.expires<=? THEN 'Expired' ELSE o.status END AS display_status FROM recruiting_offers o WHERE o.company_id=? ORDER BY o.id DESC",
    )
    .all(Date.now(), user.company_id);
  const candidates = db
    .prepare(
      "SELECT id,title FROM hr_records WHERE company_id=? AND kind='applicants' AND status='Offer' ORDER BY id DESC",
    )
    .all(user.company_id);
  const templates = db
    .prepare(
      "SELECT id,title FROM hr_records WHERE company_id=? AND kind='templates' AND status='Active' ORDER BY id DESC",
    )
    .all(user.company_id);
  const events = db
    .prepare(
      "SELECT ev.* FROM recruiting_offer_events ev JOIN recruiting_offers o ON o.id=ev.offer_id WHERE o.company_id=? ORDER BY ev.id DESC LIMIT 200",
    )
    .all(user.company_id);
  return Response.json(
    { offers, candidates, templates, events },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  const user = await requireUser(request, true);
  if (user instanceof Response) return user;
  try {
    const b = await request.json();
    if (!["issue", "rotate", "revoke"].includes(b.action))
      throw Error("Choose a valid offer action.");
    db.exec("BEGIN IMMEDIATE");
    try {
      let id: number, expires: number;
      if (b.action === "issue") {
        if (
          !Number.isSafeInteger(b.applicant_id) ||
          !Number.isSafeInteger(b.template_id) ||
          !validDate(b.start_date) ||
          !Number.isInteger(b.expires_days) ||
          b.expires_days < 1 ||
          b.expires_days > 30 ||
          typeof b.terms !== "string" ||
          !b.terms.trim() ||
          b.terms.length > 10000 ||
          b.confirmed !== true
        )
          throw Error(
            "Choose a candidate, template, start date, terms and 1–30 day expiry, and confirm issue.",
          );
        const candidate = db
          .prepare(
            "SELECT id,title,data,reference_id FROM hr_records WHERE id=? AND company_id=? AND kind='applicants' AND status='Offer'",
          )
          .get(b.applicant_id, user.company_id) as
          | { id: number; title: string; data: string; reference_id: number }
          | undefined;
        if (!candidate)
          throw Error("Candidate must be at the Offer stage in this company.");
        const approvalHash = assertHiringApproval(
          user.company_id,
          candidate.id,
        );
        const template = db
          .prepare(
            "SELECT title,body FROM hr_records WHERE id=? AND company_id=? AND kind='templates' AND status='Active'",
          )
          .get(b.template_id, user.company_id) as
          { title: string; body: string } | undefined;
        if (!template) throw Error("Choose an active company letter template.");
        const job = db
          .prepare("SELECT title FROM hr_records WHERE id=? AND company_id=?")
          .get(candidate.reference_id, user.company_id) as { title: string };
        const company = db
          .prepare("SELECT name FROM companies WHERE id=?")
          .get(user.company_id) as { name: string };
        const values: Record<string, string> = {
          candidate_name: candidate.title,
          employee_name: candidate.title,
          company_name: company.name,
          role: job.title,
          start_date: b.start_date,
          offer_terms: b.terms.trim(),
        };
        const body = template.body.replace(
          /\{\{(candidate_name|employee_name|company_name|role|start_date|offer_terms)\}\}/g,
          (_, key: string) => values[key],
        );
        // Always append the reviewed terms even when an existing template lacks the placeholder.
        const letter = template.body.includes("{{offer_terms}}")
          ? body
          : `${body}\n\nOffer terms\n${b.terms.trim()}`;
        if (letter.length > 40000)
          throw Error("Rendered offer letter is too long.");
        const now = Date.now();
        expires = now + b.expires_days * 86400000;
        const expired = db
          .prepare(
            "SELECT id FROM recruiting_offers WHERE applicant_id=? AND company_id=? AND status='Issued' AND expires<=?",
          )
          .all(candidate.id, user.company_id, now) as { id: number }[];
        for (const old of expired) {
          db.prepare(
            "UPDATE recruiting_offers SET status='Expired' WHERE id=?",
          ).run(old.id);
          db.prepare("DELETE FROM recruiting_offer_links WHERE offer_id=?").run(
            old.id,
          );
          db.prepare(
            "INSERT INTO recruiting_offer_events(offer_id,action,actor_id) VALUES (?,'Expired',?)",
          ).run(old.id, user.id);
        }
        if (
          db
            .prepare(
              "SELECT 1 FROM recruiting_offers WHERE applicant_id=? AND status='Issued'",
            )
            .get(candidate.id)
        )
          throw Error("Revoke the active offer before issuing a revision.");
        const snapshot = JSON.stringify({
          company: company.name,
          candidate: candidate.title,
          email: JSON.parse(candidate.data).email,
          job: job.title,
          start_date: b.start_date,
          terms: b.terms.trim(),
          template: template.title,
          letter,
          expires,
        });
        id = Number(
          db
            .prepare(
              "INSERT INTO recruiting_offers(company_id,applicant_id,approval_hash,snapshot,document_hash,letter,expires,created_by) VALUES (?,?,?,?,?,?,?,?)",
            )
            .run(
              user.company_id,
              candidate.id,
              approvalHash,
              snapshot,
              createHash("sha256").update(snapshot).digest("hex"),
              letter,
              expires,
              user.id,
            ).lastInsertRowid,
        );
        db.prepare(
          "INSERT INTO recruiting_offer_events(offer_id,action,actor_id) VALUES (?,'Issued',?)",
        ).run(id, user.id);
        audit(user, "Offer letter issued", String(id));
      } else {
        if (!Number.isSafeInteger(b.offer_id)) throw Error("Choose an offer.");
        const offer = db
          .prepare(
            "SELECT id,expires FROM recruiting_offers WHERE id=? AND company_id=? AND status='Issued'",
          )
          .get(b.offer_id, user.company_id) as
          { id: number; expires: number } | undefined;
        if (!offer) throw Error("Issued offer not found in this company.");
        id = offer.id;
        expires = offer.expires;
        if (b.action === "revoke") {
          db.prepare(
            "UPDATE recruiting_offers SET status='Revoked' WHERE id=?",
          ).run(id);
          db.prepare("DELETE FROM recruiting_offer_links WHERE offer_id=?").run(
            id,
          );
          db.prepare(
            "INSERT INTO recruiting_offer_events(offer_id,action,actor_id) VALUES (?,'Revoked',?)",
          ).run(id, user.id);
          audit(user, "Offer revoked", String(id));
          db.exec("COMMIT");
          return Response.json({ ok: true });
        }
        if (expires <= Date.now())
          throw Error("This offer has expired. Issue a new revision.");
        db.prepare(
          "INSERT INTO recruiting_offer_events(offer_id,action,actor_id) VALUES (?,'Link rotated',?)",
        ).run(id, user.id);
        audit(user, "Offer link rotated", String(id));
      }
      const token = randomBytes(32).toString("hex");
      db.prepare("DELETE FROM recruiting_offer_links WHERE offer_id=?").run(id);
      db.prepare(
        "INSERT INTO recruiting_offer_links(token_hash,offer_id,expires) VALUES (?,?,?)",
      ).run(digest(token), id, expires);
      db.exec("COMMIT");
      return Response.json(
        { ok: true, id, path: `/offer#token=${token}`, expires },
        {
          status: b.action === "issue" ? 201 : 200,
          headers: { "Cache-Control": "no-store" },
        },
      );
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Unable to manage offer." },
      { status: 400 },
    );
  }
}
