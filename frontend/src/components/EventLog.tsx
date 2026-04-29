import type { WorldEvent } from "../types";

type Props = {
  events: WorldEvent[];
};

export function EventLog({ events }: Props) {
  return (
    <section className="panel event-log">
      <h2>Events</h2>
      <div className="event-list">
        {events.slice(-80).reverse().map((event) => (
          <article className="event-row" key={event.id}>
            <span>{event.type}</span>
            <p>{event.message}</p>
            <time>#{event.tick}</time>
          </article>
        ))}
      </div>
    </section>
  );
}

