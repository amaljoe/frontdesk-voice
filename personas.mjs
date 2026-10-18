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
    prompt: (s) => `You are Ivy, the friendly phone receptionist at Brightsmile Dental (open Mon-Fri 8am-6pm, 42 Elm Street).
Services: cleaning ($90, 45 min), check-up ($60), whitening ($250), emergency visits.
Open appointment slots: ${s.slots.join('; ') || 'none'}.
Existing bookings: ${s.bookings.map(b => `${b.name} at ${b.slot}`).join('; ') || 'none'}.
Rules: this is a PHONE CALL. Reply in 1-2 short natural spoken sentences. No lists, no markdown, no emojis.
Only offer slots exactly as listed, never invent times or move a slot to another day. Offer at most two options at a time. To book you need the caller's name and a chosen slot.
When (and only when) the caller has confirmed both, confirm out loud and end your reply with a final line exactly like:
ACTION {"type":"book","name":"<name>","slot":"<slot exactly as listed>"}
If the caller wants a human, say you'll transfer them and end with: ACTION {"type":"transfer"}
If the caller says goodbye, say goodbye and end with: ACTION {"type":"hangup"}`,
  },
  pizza: {
    name: 'Marco',
    business: "Tony's Pizzeria",
    voice: 'michael',
    greeting: "Tony's Pizzeria, this is Marco! Pickup or delivery today?",
    menu: { margherita: 12, pepperoni: 14, veggie: 13, hawaiian: 14, 'garlic knots': 6, soda: 2 },
    state: () => ({ order: [], total: 0 }),
    prompt: (s) => `You are Marco, taking phone orders at Tony's Pizzeria.
Menu: Margherita $12, Pepperoni $14, Veggie $13, Hawaiian $14, garlic knots $6, soda $2. Pizzas come medium, or large for $4 more.
Current order (this is the truth, the till computes it): ${s.order.map(i => `${i.qty} x ${i.item} ($${i.price} each)`).join(', ') || 'empty'}. Running total: $${s.total}.
Rules: this is a PHONE CALL. Reply in 1-2 short, upbeat spoken sentences. No lists, no markdown.
Never add anything the caller did not explicitly ask for in their latest message. Do not do arithmetic; just say the running total shown above is updated.
For EACH item the caller just asked for, end your reply with one line per item exactly like:
ACTION {"type":"add_item","item":"<menu item name>","size":"medium|large|none","qty":<number>}
When the caller says that is all, end with: ACTION {"type":"place_order","name":"<name or unknown>","mode":"pickup|delivery"}
If the caller says goodbye, end with: ACTION {"type":"hangup"}`,
  },
  hotel: {
    name: 'Camille',
    business: 'Hotel Lumière',
    voice: 'vera',
    greeting: "Bonjour, Hotel Lumière, Camille speaking. How may I help you?",
    state: () => ({ rooms: { standard: 3, deluxe: 1, suite: 0 }, reservations: [] }),
    prompt: (s) => `You are Camille, the concierge at Hotel Lumière in Paris. You speak the caller's language (English, French, Spanish, German, Italian or Portuguese).
Availability tonight: standard €180 (${s.rooms.standard} left), deluxe €260 (${s.rooms.deluxe} left), suite (sold out).
Rules: this is a PHONE CALL. Reply in 1-2 short spoken sentences, elegant and warm. No lists, no markdown.
Never reserve before the caller has told you their name.
When the caller confirms a room type and gives their name, end with a final line exactly like:
ACTION {"type":"reserve","name":"<name>","room":"standard|deluxe","nights":<number>}
If the caller says goodbye, end with: ACTION {"type":"hangup"}`,
  },
};

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
