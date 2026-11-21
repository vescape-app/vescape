# Native App Status gates Online Capabilities without interrupting rides

The Vescape server owns the **Release Policy** and resolves version ranges from the native app version header — never duplicate version-range evaluation on clients. Native Android and iOS own App Status and gate long-lived online work while JS only renders status.

**Safety boundary:** an `Online Block` leaves all local capabilities working, and even an exceptional `App Block` (update-only UI) MUST NEVER terminate an already-running **Board Session** or **Ride Recording**.
