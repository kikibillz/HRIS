import { sameOrigin, digest } from "@/lib/auth";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json(
      { error: "Request origin is not allowed." },
      { status: 403 },
    );
  try {
    const b = await request.json();
    if (typeof b.token !== "string" || !/^[a-f0-9]{64}$/.test(b.token))
      return Response.json(
        { error: "Offer link is invalid or unavailable." },
        { status: 404 },
      );
    if (!["view", "respond"].includes(b.action))
      return Response.json(
        { error: "Choose a valid response action." },
        { status: 400 },
      );
    db.exec("BEGIN IMMEDIATE");
    try {
      const offer = db
        .prepare(
          "SELECT o.id,o.applicant_id,o.snapshot,o.document_hash,o.letter,o.status,o.expires,o.first_viewed,o.response_name,o.responded FROM recruiting_offer_links l JOIN recruiting_offers o ON o.id=l.offer_id WHERE l.token_hash=? AND l.expires>? AND o.expires>? AND o.status IN ('Issued','Accepted','Declined')",
        )
        .get(digest(b.token), Date.now(), Date.now()) as
        | {
            id: number;
            applicant_id: number;
            snapshot: string;
            document_hash: string;
            letter: string;
            status: string;
            expires: number;
            first_viewed: string | null;
            response_name: string;
            responded: string | null;
          }
        | undefined;
      if (!offer) {
        db.exec("ROLLBACK");
        return Response.json(
          { error: "Offer link is invalid or unavailable." },
          { status: 404 },
        );
      }
      if (b.action === "respond") {
        const candidate = db
          .prepare(
            "SELECT status FROM hr_records WHERE id=? AND kind='applicants'",
          )
          .get(offer.applicant_id) as { status: string } | undefined;
        if (candidate?.status !== "Offer")
          throw Error("This offer is no longer accepting responses.");
        if (
          offer.status !== "Issued" ||
          !["Accepted", "Declined"].includes(b.decision) ||
          typeof b.name !== "string" ||
          !b.name.trim() ||
          b.name.trim().length > 120 ||
          b.confirmed !== true
        )
          throw Error(
            "Provide your name, choose a response and confirm. Offers can only be answered once.",
          );
        db.prepare(
          "UPDATE recruiting_offers SET status=?,response_name=?,responded=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='Issued'",
        ).run(b.decision, b.name.trim(), offer.id);
        db.prepare(
          "INSERT INTO recruiting_offer_events(offer_id,action) VALUES (?,?)",
        ).run(offer.id, b.decision);
      } else if (!offer.first_viewed) {
        db.prepare(
          "UPDATE recruiting_offers SET first_viewed=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
        ).run(offer.id);
        db.prepare(
          "INSERT INTO recruiting_offer_events(offer_id,action) VALUES (?,'Viewed')",
        ).run(offer.id);
      }
      const final = db
        .prepare(
          "SELECT status,response_name,responded FROM recruiting_offers WHERE id=?",
        )
        .get(offer.id);
      const snapshot = JSON.parse(offer.snapshot);
      db.exec("COMMIT");
      return Response.json(
        {
          offer: {
            company: snapshot.company,
            candidate: snapshot.candidate,
            job: snapshot.job,
            start_date: snapshot.start_date,
            letter: offer.letter,
            document_hash: offer.document_hash,
            expires: offer.expires,
            ...final,
          },
        },
        {
          headers: {
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
          },
        },
      );
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Unable to record response." },
      { status: 400 },
    );
  }
}
