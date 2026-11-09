export type AlertFrequency = "daily" | "weekly" | "monthly";

const dayInMilliseconds = 24 * 60 * 60 * 1000;

function advanceDelivery(
  previous: Date,
  frequency: AlertFrequency,
  scheduleDay: number
) {
  if (frequency === "daily") {
    return new Date(previous.getTime() + dayInMilliseconds);
  }
  if (frequency === "weekly") {
    return new Date(previous.getTime() + 7 * dayInMilliseconds);
  }

  const year = previous.getUTCFullYear();
  const month = previous.getUTCMonth() + 1;
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(scheduleDay, lastDayOfMonth),
      previous.getUTCHours(),
      previous.getUTCMinutes()
    )
  );
}

export function getFirstAlertDelivery(
  deliveryTimeUtc: string,
  frequency: AlertFrequency,
  now = new Date()
) {
  const [hours, minutes] = deliveryTimeUtc.split(":").map(Number);
  const candidate = new Date(now);
  candidate.setUTCHours(hours, minutes, 0, 0);
  const scheduleDay = candidate.getUTCDate();

  if (candidate <= now) {
    return {
      nextDeliveryAt: advanceDelivery(candidate, frequency, scheduleDay),
      scheduleDay,
    };
  }
  return { nextDeliveryAt: candidate, scheduleDay };
}

export function getNextAlertDelivery(
  previousDelivery: Date,
  frequency: AlertFrequency,
  scheduleDay: number,
  now = new Date()
) {
  let nextDelivery = advanceDelivery(previousDelivery, frequency, scheduleDay);
  while (nextDelivery <= now) {
    nextDelivery = advanceDelivery(nextDelivery, frequency, scheduleDay);
  }
  return nextDelivery;
}
