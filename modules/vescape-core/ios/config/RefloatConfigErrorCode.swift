/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatConfigModels.kt `RefloatConfigErrorCode`
/// @parity /modules/vescape-core/src/index.ts `RefloatConfigErrorCode`
enum RefloatConfigErrorCode: String {
  case BOARD_NOT_CONNECTED
  case LINK_NOT_TRUSTED
  case CAN_ID_UNAVAILABLE
  case GATT_NOT_WRITABLE
  case CONFIG_REQUEST_IN_FLIGHT
  case CONFIG_SCHEMA_TIMEOUT
  case CONFIG_READ_TIMEOUT
  case CONFIG_READ_FAILED
  case CONFIG_WRITE_TIMEOUT
  case CONFIG_WRITE_FAILED
  case CONFIG_VERIFY_FAILED
  case UNEXPECTED_CONFIG_RESPONSE
  case UNSUPPORTED_SCHEMA
  case CONFIG_DECODE_FAILED
  case CONFIG_ENCODE_FAILED
  case CONFIG_VALUE_INVALID
  case BOARD_NOT_IDLE
  case PROFILE_NOT_FOUND
  case PROFILE_BOARD_MISMATCH
  case REVISION_NOT_FOUND
  case SCHEMA_NOT_FOUND
  case INVALID_CONFIG_XML
  case UNSUPPORTED_PLATFORM
}
