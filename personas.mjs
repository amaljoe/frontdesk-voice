// Each persona: who the agent is, the business state it can act on, and the actions it may emit.
// The small gateway model has no tool-calling, so actions are emitted as a trailing
// `ACTION {json}` line that the server strips from speech and executes.

export const personas = {
  dental: {
    name: 'Ivy',
    business: 'Brightsmile Dental',
    voice: 'jane',
    greeting: "Hi, thanks for calling Brightsmile Dental, this is Ivy. How can I help you today?",
    state: () => ({
      slots: ['Tuesday 10:00 AM', 'Tuesday 2:30 PM', 'Wednesday 9:00 AM', 'Thursday 4:15 PM'],
      bookings: [],
    }),
    brief: (s) => `You're Ivy, and you answer the phones at Brightsmile Dental. We're at 42 Elm Street, open Monday to Friday, 8 to 6.

What we do: cleanings ($90, takes about 45 minutes), check-ups ($60), whitening ($250), and we squeeze in emergencies when we can.

Here's what's still open on the calendar: ${s.slots.join(', ') || 'nothing this week, sorry'}.
Already booked: ${s.bookings.map(b => `${b.name} at ${b.slot}`).join(', ') || 'nobody yet'}.

Keep in mind you're on the phone, so talk like a person would. A sentence or two at a time, no lists. If someone asks what's free, give them two options rather than reading out the whole week. Only offer the times above. Please don't make up a time or move one to a different day, because then we end up double-booked.

You'll need their name and the time they want before you book anything.`,
    actions: `Once they've given you both, confirm it back to them, then put this on its own line at the very end:
ACTION {"type":"book","name":"<their name>","slot":"<the slot, written exactly like the list>"}
If they want to talk to a real person, tell them you'll put them through and end with ACTION {"type":"transfer"}
When they say goodbye, say bye and end with ACTION {"type":"hangup"}`,
  },
  pizza: {
    name: 'Marco',
    business: "Tony's Pizzeria",
    voice: 'michael',
    greeting: "Tony's Pizzeria, this is Marco! Pickup or delivery today?",
    menu: { margherita: 12, pepperoni: 14, veggie: 13, hawaiian: 14, 'garlic knots': 6, soda: 2 },
    state: () => ({ order: [], total: 0 }),
    brief: (s) => `You're Marco, you take phone orders at Tony's Pizzeria. Friendly, quick, a bit of energy.

Menu: margherita $12, pepperoni $14, veggie $13, hawaiian $14. Those are mediums, a large is $4 more. On the side we've got garlic knots for $6 and sodas for $2.

The order so far, straight from the till: ${s.order.map(i => `${i.qty} x ${i.item} ($${i.price} each)`).join(', ') || 'nothing yet'}. Total right now is $${s.total}. Go by that number and don't add it up yourself, because the till is always right.

It's a phone call, so keep it short and chatty. Only put in what the caller actually asks for. Don't add extras because you think they'd like them. No need to read the whole order back every time, just the thing they added. Do the full read-back once, when they're done.`,
    actions: `Every time they ask for something, add a line at the end for each item, like this:
ACTION {"type":"add_item","item":"<menu item>","size":"medium|large|none","qty":<number>}
When they say that's everything: ACTION {"type":"place_order","name":"<their name, or unknown>","mode":"pickup|delivery"}
When they say bye: ACTION {"type":"hangup"}`,
  },
  hotel: {
    name: 'Camille',
    business: 'Hotel Lumière',
    voice: 'vera',
    greeting: "Bonjour, Hotel Lumière, Camille speaking. How may I help you?",
    state: () => ({ rooms: { standard: 3, deluxe: 1, suite: 0 }, reservations: [] }),
    brief: (s) => `You're Camille, the concierge at Hotel Lumière in Paris. Guests call from everywhere, so answer in whatever language they use: English, French, Spanish, German, Italian or Portuguese.

Tonight we have standard rooms at €180 (${s.rooms.standard} left) and deluxe at €260 (${s.rooms.deluxe} left). The suite's gone.

On the phone keep it to a sentence or two, warm and a little elegant. Don't reserve anything until you know their name.`,
    actions: `Once they've picked a room and told you their name, end your reply with this on its own line:
ACTION {"type":"reserve","name":"<their name>","room":"standard|deluxe","nights":<number>}
When they say goodbye: ACTION {"type":"hangup"}`,
  },
};

// The text pipeline needs the ACTION-line instructions; tool-calling engines just use the brief.
for (const p of Object.values(personas)) p.prompt = (s, { tools = false } = {}) => (tools ? p.brief(s) : `${p.brief(s)}\n\n${p.actions}`);

// Guard against the model acting on things the caller never said (small models do).
// `callerText` is everything the caller has said this call; `userText` is their latest turn.
export function plausible(a, userText, callerText = userText) {
  const u = userText.toLowerCase();
  // A booking name must be something the caller actually said, not a model placeholder.
  if (['book', 'reserve'].includes(a.type)) {
    const first = String(a.name || '').toLowerCase().split(/\s+/)[0];
    if (!first || first.length < 2 || !callerText.toLowerCase().includes(first)) return false;
  }
  if (a.type === 'add_item') return Object.keys(personas.pizza.menu).some((k) => String(a.item).toLowerCase().includes(k) && (u.includes(k) || u.includes(k.split(' ')[0]) || u.includes(k.replace(/s$/, ''))));
  if (a.type === 'hangup') return /\b(bye|goodbye|that's all|hang up|au revoir|adi[oó]s|tsch[uü]ss|ciao|tchau)\b/i.test(u);
  return true;
}

// Apply an action to the persona's state; returns a human-readable event for the UI.
export function applyAction(persona, state, a) {
  switch (a.type) {
    case 'book': {
      const i = state.slots.findIndex(s => s.toLowerCase() === String(a.slot).toLowerCase());
      if (i < 0) return { ok: false, title: 'Booking failed', detail: `Slot "${a.slot}" is not available` };
      const [slot] = state.slots.splice(i, 1);
      state.bookings.push({ name: a.name, slot });
      return { ok: true, title: 'Appointment booked', detail: `${a.name} · ${slot}` };
    }
    case 'add_item': {
      // Prices come from the menu, never from the model.
      const key = Object.keys(persona.menu).find((k) => String(a.item).toLowerCase().includes(k));
      if (!key) return { ok: false, title: 'Not on the menu', detail: String(a.item) };
      const large = /large/i.test(a.size) || /large/i.test(a.item);
      const pizza = !['garlic knots', 'soda'].includes(key);
      const item = pizza ? `${large ? 'large' : 'medium'} ${key}` : key;
      const price = persona.menu[key] + (pizza && large ? 4 : 0), qty = Math.max(1, Number(a.qty) || 1);
      state.order.push({ item, qty, price });
      state.total = state.order.reduce((t, i) => t + i.qty * i.price, 0);
      return { ok: true, title: 'Item added', detail: `${qty} × ${item} · $${price * qty}` };
    }
    case 'place_order':
      if (!state.order.length) return { ok: false, title: 'Order empty', detail: 'Nothing to place' };
      state.placed = { name: a.name, mode: a.mode || 'pickup', total: state.total };
      return { ok: true, title: 'Order placed', detail: `${a.name || 'guest'} · ${a.mode || 'pickup'} · $${state.total}` };
    case 'reserve': {
      const room = String(a.room || '').toLowerCase();
      if (!state.rooms[room]) return { ok: false, title: 'Reservation failed', detail: `No ${room} rooms left` };
      state.rooms[room]--;
      state.reservations.push(a);
      return { ok: true, title: 'Room reserved', detail: `${a.name} · ${room} · ${a.nights || 1} night(s)` };
    }
    case 'transfer': return { ok: true, title: 'Transferring', detail: 'Handing off to a human' };
    case 'hangup': return { ok: true, title: 'Call ended', detail: 'Caller said goodbye' };
    default: return { ok: false, title: 'Unknown action', detail: a.type };
  }
}
