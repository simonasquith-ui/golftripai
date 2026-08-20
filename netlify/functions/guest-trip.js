/*
 * guest-trip.js — the only door a non-logged-in guest has into a trip.
 *
 * WHY THIS EXISTS
 * Guests have no Supabase access at all (see 007_guest_voting.sql). Row Level
 * Security cannot help here: a guest has no auth.uid(), and Postgres cannot
 * read the share token out of their URL. So the check happens here, where the
 * token IS readable, using the service-role key.
 *
 * WHAT A GUEST MAY DO — and this list is the security boundary, so keep it
 * short and keep it honest:
 *   - see the trip's destination, dates and group size
 *   - see the shortlist and vote on it
 *   - see the first names of who else is coming
 *
 * WHAT A GUEST MAY NEVER SEE. None of this is returned by any branch below:
 *   - the basket, the cost split, or the ledger (who owes and who has paid)
 *   - anybody's email address, user id, or account details
 *   - any other trip, including other trips by the same organiser
 *
 * If you add a field to a response, check it against that list first.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ddordyjwkdwqaarplwmc.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function reply(statusCode, body) {
  return { statusCode, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

// Thin PostgREST wrapper. Service role, so RLS is bypassed — which is exactly
// why every query below is explicitly scoped to one trip id.
async function db(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!res.ok) {
    const err = new Error((data && data.message) || `Supabase ${res.status}`);
    err.status = res.status;
    err.detail = data;
    throw err;
  }
  return data;
}

/* Validate the token and return the trip, or throw. Every action starts here —
   there is no path to trip data that skips this. */
async function requireTrip(tripId, token) {
  if (!UUID_RE.test(tripId || '')) { const e = new Error('Invalid trip.'); e.status = 400; throw e; }
  if (!UUID_RE.test(token || ''))  { const e = new Error('Invalid link.');  e.status = 400; throw e; }

  const rows = await db(
    `trip_requests?id=eq.${tripId}&share_token=eq.${token}` +
    `&select=id,destination_type,group_size,travel_dates,user_id,guest_voting,share_expires_at`
  );
  const trip = rows && rows[0];
  // Same message whether the id is wrong, the token is wrong, or the pair
  // doesn't match — no probing for which half was right.
  if (!trip) { const e = new Error('This voting link is not valid.'); e.status = 404; throw e; }

  if (!trip.guest_voting) {
    const e = new Error('The organiser has turned off guest voting for this trip.');
    e.status = 403; throw e;
  }
  if (trip.share_expires_at && new Date(trip.share_expires_at) < new Date()) {
    const e = new Error('This voting link has expired. Ask the organiser for a new one.');
    e.status = 410; throw e;
  }
  return trip;
}

/* Everything a guest is allowed to see, assembled in one place so there is a
   single point to audit. */
async function guestView(trip, guest) {
  const [candidates, members, guests] = await Promise.all([
    db(`trip_candidates?trip_request_id=eq.${trip.id}&status=neq.dropped` +
       `&select=id,title,description,category,price,status,sort_order&order=sort_order.asc`),
    db(`trip_members?trip_request_id=eq.${trip.id}&select=user_id,role,status`),
    db(`trip_guests?trip_request_id=eq.${trip.id}&select=id,name`)
  ]);

  const ids = (candidates || []).map(c => c.id);
  // Votes have to be fetched after the candidate ids are known, and only for
  // this trip's candidates — never a bare select over the whole table.
  const allVotes = ids.length
    ? await db(`trip_candidate_votes?candidate_id=in.(${ids.join(',')})&select=candidate_id,vote,user_id,guest_id`)
    : [];

  // First names only. Members are looked up by id, and only `name` is
  // selected — no email leaves this function.
  const memberIds = (members || []).map(m => m.user_id).filter(Boolean);
  let memberNames = [];
  if (memberIds.length) {
    const users = await db(`users?id=in.(${memberIds.join(',')})&select=id,name`);
    memberNames = (users || []).map(u => firstName(u.name)).filter(Boolean);
  }

  const tally = {};
  (allVotes || []).forEach(v => {
    const t = tally[v.candidate_id] || (tally[v.candidate_id] = { yes: 0, meh: 0, no: 0 });
    if (v.vote === 1) t.yes++; else if (v.vote === -1) t.no++; else t.meh++;
  });

  const mine = {};
  if (guest) {
    (allVotes || []).forEach(v => { if (v.guest_id === guest.id) mine[v.candidate_id] = v.vote; });
  }

  return {
    trip: {
      destination: trip.destination_type || null,
      groupSize: trip.group_size || null,
      dates: safeDates(trip.travel_dates)
    },
    candidates: (candidates || []).map(c => ({
      id: c.id, title: c.title, description: c.description,
      category: c.category, price: c.price, status: c.status,
      votes: tally[c.id] || { yes: 0, meh: 0, no: 0 }
    })),
    people: memberNames.concat((guests || []).map(g => firstName(g.name))).filter(Boolean),
    myVotes: mine,
    guest: guest ? { name: guest.name } : null
  };
}

function firstName(n) {
  return String(n || '').trim().split(/\s+/)[0] || '';
}

function safeDates(raw) {
  if (!raw) return null;
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { depart: o.depart || null, returnDate: o.returnDate || null };
  } catch (e) { return null; }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  if (!SERVICE_KEY) return reply(500, { error: 'SUPABASE_SERVICE_ROLE_KEY not set' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return reply(400, { error: 'Bad request body' }); }

  const { action, tripId, token, guestKey, name, candidateId, vote } = body;

  try {
    const trip = await requireTrip(tripId, token);

    // Look up the guest from their key. The key alone is never enough — the
    // token has already been checked, and the guest must belong to THIS trip.
    let guest = null;
    if (guestKey && UUID_RE.test(guestKey)) {
      const g = await db(`trip_guests?trip_request_id=eq.${trip.id}&guest_key=eq.${guestKey}&select=id,name,guest_key`);
      guest = (g && g[0]) || null;
    }

    if (action === 'join') {
      const clean = String(name || '').trim().slice(0, 40);
      if (clean.length < 2) return reply(400, { error: 'Please enter your name.' });

      if (guest) {
        await db(`trip_guests?id=eq.${guest.id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ name: clean, last_seen_at: new Date().toISOString() })
        });
        guest.name = clean;
      } else {
        const created = await db('trip_guests', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ trip_request_id: trip.id, name: clean })
        });
        guest = created && created[0];
      }
      const view = await guestView(trip, guest);
      // guest_key goes back exactly once, for the browser to keep. It is the
      // guest's only way to change their own vote later.
      return reply(200, { ...view, guestKey: guest.guest_key });
    }

    if (action === 'load') {
      return reply(200, await guestView(trip, guest));
    }

    if (action === 'vote') {
      if (!guest) return reply(401, { error: 'Tell us your name before voting.' });
      if (!UUID_RE.test(candidateId || '')) return reply(400, { error: 'Invalid item.' });
      const v = Number(vote);
      if (![1, 0, -1].includes(v)) return reply(400, { error: 'Invalid vote.' });

      // The candidate must belong to this trip. Without this check a guest
      // could vote on another group's shortlist by pasting in its id.
      const cand = await db(`trip_candidates?id=eq.${candidateId}&trip_request_id=eq.${trip.id}&select=id`);
      if (!cand || !cand.length) return reply(404, { error: 'That option is no longer on the shortlist.' });

      const existing = await db(`trip_candidate_votes?candidate_id=eq.${candidateId}&guest_id=eq.${guest.id}&select=id`);
      if (existing && existing.length) {
        await db(`trip_candidate_votes?id=eq.${existing[0].id}`, {
          method: 'PATCH', body: JSON.stringify({ vote: v })
        });
      } else {
        await db('trip_candidate_votes', {
          method: 'POST', body: JSON.stringify({ candidate_id: candidateId, guest_id: guest.id, vote: v })
        });
      }
      return reply(200, await guestView(trip, guest));
    }

    return reply(400, { error: 'Unknown action.' });

  } catch (err) {
    const status = err.status || 500;
    // Don't leak Supabase internals to an unauthenticated caller.
    const message = status >= 500 ? 'Something went wrong. Please try again.' : err.message;
    if (status >= 500) console.error('guest-trip:', err.message, err.detail || '');
    return reply(status, { error: message });
  }
};
