package expo.modules.vescapecore.service

import android.content.pm.ServiceInfo

internal fun foregroundServiceType(
    boardActive: Boolean,
    gpsActive: Boolean,
    accessoryActive: Boolean = false,
): Int {
    var type = 0
    if (boardActive || accessoryActive) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
    if (gpsActive) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
    return type
}

internal fun foregroundServiceTypeForConnectedDevicePromotion(
    boardActive: Boolean,
    gpsActive: Boolean,
): Int =
    foregroundServiceType(
        boardActive = boardActive,
        gpsActive = gpsActive,
    ) or ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
