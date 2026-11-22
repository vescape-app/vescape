import Foundation

struct RefloatXmlError: Error {
  let message: String
}

final class RefloatXmlNode {
  let name: String
  let attributes: [String: String]
  private(set) var children: [RefloatXmlNode] = []
  private var text: String = ""

  init(name: String, attributes: [String: String]) {
    self.name = name
    self.attributes = attributes
  }

  func attribute(_ key: String) -> String? { attributes[key] }

  var textContent: String {
    var result = text
    for child in children { result += child.textContent }
    return result
  }

  func descendants(named tag: String) -> [RefloatXmlNode] {
    var result: [RefloatXmlNode] = []
    for child in children {
      if child.name == tag { result.append(child) }
      result.append(contentsOf: child.descendants(named: tag))
    }
    return result
  }

  static func parse(_ data: Data) throws -> RefloatXmlNode {
    let builder = Builder()
    let parser = XMLParser(data: data)
    parser.delegate = builder
    parser.shouldResolveExternalEntities = false
    guard parser.parse(), let root = builder.root else {
      let reason = parser.parserError?.localizedDescription ?? builder.failure ?? "invalid XML"
      throw RefloatXmlError(message: reason)
    }
    return root
  }

  fileprivate func appendChild(_ child: RefloatXmlNode) { children.append(child) }
  fileprivate func appendText(_ value: String) { text += value }
}

private final class Builder: NSObject, XMLParserDelegate {
  private(set) var root: RefloatXmlNode?
  private(set) var failure: String?
  private var stack: [RefloatXmlNode] = []

  func parser(
    _ parser: XMLParser,
    didStartElement elementName: String,
    namespaceURI: String?,
    qualifiedName qName: String?,
    attributes attributeDict: [String: String]
  ) {
    let node = RefloatXmlNode(name: elementName, attributes: attributeDict)
    stack.last?.appendChild(node)
    if root == nil { root = node }
    stack.append(node)
  }

  func parser(_ parser: XMLParser, foundCharacters string: String) {
    stack.last?.appendText(string)
  }

  func parser(
    _ parser: XMLParser,
    didEndElement elementName: String,
    namespaceURI: String?,
    qualifiedName qName: String?
  ) {
    stack.removeLast()
  }
}
