# Navigation recalculates when the rider leaves the path

Navigation used to be computed once and then fixed. The reasoning: EUC riders leave the line by
hundreds of metres as a matter of course, and a path that redraws itself under them is worse than a
stale one. Only a rider's tap replaced a Navigation.

In practice a stale path is the bigger problem. Once the rider takes a different way, the drawn path,
the remaining distance and the wrist arrow all describe a route they are no longer on, and the only
fix is stopping to tap Recompute.

We decided that native recalculates the Navigation automatically when the rider is farther from the
path than the **Reroute Distance** setting. This reverses the "no rerouting" rule from #353.

## Status

Accepted.

## Decision

- **Distance from the path is the only trigger.** It is the straight line from the rider to their
  Route Progress projection. Growth in remaining distance does not trigger: the projection is the
  nearest point, so on a path that passes near itself it can snap between legs and remaining
  distance jumps while the rider is still on the path.
- **The Reroute Distance is a setting**, 50 m by default, 1–1000 m, in Advanced settings → Map.
  Riders who wander on purpose can raise it.
- **Native owns it.** The check runs on every GPS Fix in `NavigationController`, so it works while
  JS is suspended and reaches the Wear Mirror the same way any other path change does.
- **An automatic attempt never costs the rider their path.** A failed attempt keeps the drawn path.
  Attempts never overlap, and a rider intent (new target, profile, recompute, clear) supersedes one
  in flight. While attempts keep failing they back off from 30 seconds up to 5 minutes; a success
  resets the backoff.
- **Automatic replacements are marked as such.** Every published Navigation carries a process-local
  `revision` and an `automatic` flag. JS keeps an accepted path accepted across automatic
  replacements and does not move the camera of a map that is already open.

## Consequences

- On a path that doubles back on itself, a rider can be projected onto the wrong leg without that
  causing a reroute. They see a jump in remaining distance, not a new path.
- Recalculation uses the routing service while riding, including offline retries limited by the
  backoff.
