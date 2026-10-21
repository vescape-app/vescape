# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role, use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary the repo actually uses.

## Area labels

Area labels (`area:*`) tag the part of the system an issue touches. Apply as
many as fit. Two are flagged red because they signal extra implementation risk:

| Label         | Meaning                                                    |
| ------------- | ---------------------------------------------------------- |
| `area:native` | Touches native side (`modules/vescape-core`, Swift/Kotlin) |
| `area:db`     | Includes a database migration                              |

When an issue carries `area:native` or `area:db`, expect native rebuilds and/or
storage migrations — factor that into the agent brief and complexity rating.
