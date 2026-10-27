use serde_json::{json, Value};

use super::tools::ToolRegistry;

pub async fn handle_mcp_message(registry: &ToolRegistry, raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let parsed: Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(e) => {
            let err = json!({
                "jsonrpc": "2.0",
                "id": Value::Null,
                "error": {
                    "code": -32700,
                    "message": format!("Parse error: {e}")
                }
            });
            return serde_json::to_string(&err).ok();
        }
    };

    let obj = match parsed.as_object() {
        Some(o) => o,
        None => {
            let err = json!({
                "jsonrpc": "2.0",
                "id": Value::Null,
                "error": {
                    "code": -32600,
                    "message": "Invalid Request: expected JSON object"
                }
            });
            return serde_json::to_string(&err).ok();
        }
    };

    let id = obj.get("id").cloned();
    let method = match obj.get("method").and_then(|v| v.as_str()) {
        Some(m) => m,
        None => {
            if id.is_some() {
                let err = json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": {
                        "code": -32600,
                        "message": "Invalid Request: missing method"
                    }
                });
                return serde_json::to_string(&err).ok();
            } else {
                return None;
            }
        }
    };

    // Notifications receive no response in JSON-RPC 2.0
    if id.is_none() || method == "notifications/initialized" {
        return None;
    }

    let id_val = id.unwrap_or(Value::Null);

    let response = match method {
        "initialize" => {
            let result = json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {}
                },
                "serverInfo": {
                    "name": "liosvideo",
                    "version": "0.1.0"
                }
            });
            json!({
                "jsonrpc": "2.0",
                "id": id_val,
                "result": result
            })
        }
        "ping" => {
            json!({
                "jsonrpc": "2.0",
                "id": id_val,
                "result": {}
            })
        }
        "tools/list" => {
            let tools = registry.list();
            json!({
                "jsonrpc": "2.0",
                "id": id_val,
                "result": {
                    "tools": tools
                }
            })
        }
        "tools/call" => {
            let params = obj.get("params").and_then(|v| v.as_object());
            let tool_name = params.and_then(|p| p.get("name")).and_then(|v| v.as_str());

            match tool_name {
                Some(name) => match registry.get(name) {
                    Some(tool) => {
                        let args = params
                            .and_then(|p| p.get("arguments"))
                            .cloned()
                            .unwrap_or(Value::Object(Default::default()));

                        match tool.call(args).await {
                            Ok(val) => {
                                let content_val = match val {
                                    Value::Object(ref map) if map.contains_key("content") => val,
                                    Value::Array(arr) => json!({ "content": arr }),
                                    Value::String(s) => json!({
                                        "content": [{ "type": "text", "text": s }]
                                    }),
                                    other => json!({
                                        "content": [{
                                            "type": "text",
                                            "text": serde_json::to_string_pretty(&other)
                                                .unwrap_or_else(|_| other.to_string())
                                        }]
                                    }),
                                };
                                json!({
                                    "jsonrpc": "2.0",
                                    "id": id_val,
                                    "result": content_val
                                })
                            }
                            Err(err_msg) => json!({
                                "jsonrpc": "2.0",
                                "id": id_val,
                                "result": {
                                    "content": [
                                        {
                                            "type": "text",
                                            "text": err_msg
                                        }
                                    ],
                                    "isError": true
                                }
                            }),
                        }
                    }
                    None => json!({
                        "jsonrpc": "2.0",
                        "id": id_val,
                        "error": {
                            "code": -32601,
                            "message": "Method not found"
                        }
                    }),
                },
                None => json!({
                    "jsonrpc": "2.0",
                    "id": id_val,
                    "error": {
                        "code": -32602,
                        "message": "Invalid params: missing tool name"
                    }
                }),
            }
        }
        _ => json!({
            "jsonrpc": "2.0",
            "id": id_val,
            "error": {
                "code": -32601,
                "message": "Method not found"
            }
        }),
    };

    serde_json::to_string(&response).ok()
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use serde_json::json;

    use super::*;
    use crate::mcp::tools::{BoxFuture, Tool, ToolRegistry};

    struct DummyTool;

    impl Tool for DummyTool {
        fn name(&self) -> &'static str {
            "dummy_tool"
        }

        fn description(&self) -> &'static str {
            "A dummy tool for testing"
        }

        fn input_schema(&self) -> serde_json::Value {
            json!({
                "type": "object",
                "properties": {
                    "foo": { "type": "string" }
                }
            })
        }

        fn call(&self, args: serde_json::Value) -> BoxFuture<Result<serde_json::Value, String>> {
            Box::pin(async move {
                let foo = args.get("foo").and_then(|v| v.as_str()).unwrap_or("default");
                Ok(json!({
                    "content": [
                        {
                            "type": "text",
                            "text": format!("called with {}", foo)
                        }
                    ]
                }))
            })
        }
    }

    struct FailingTool;

    impl Tool for FailingTool {
        fn name(&self) -> &'static str {
            "failing_tool"
        }

        fn description(&self) -> &'static str {
            "A tool that returns an error"
        }

        fn input_schema(&self) -> serde_json::Value {
            json!({})
        }

        fn call(&self, _args: serde_json::Value) -> BoxFuture<Result<serde_json::Value, String>> {
            Box::pin(async move { Err("something went wrong".to_string()) })
        }
    }

    #[tokio::test]
    async fn test_initialize() {
        let registry = ToolRegistry::new();
        let raw = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": { "name": "test-client", "version": "1.0.0" }
            }
        })
        .to_string();

        let response = handle_mcp_message(&registry, &raw).await;
        assert!(response.is_some());
        let res: serde_json::Value = serde_json::from_str(&response.unwrap()).unwrap();
        assert_eq!(res["jsonrpc"], "2.0");
        assert_eq!(res["id"], 1);
        assert_eq!(res["result"]["protocolVersion"], "2024-11-05");
        assert_eq!(res["result"]["serverInfo"]["name"], "liosvideo");
        assert_eq!(res["result"]["serverInfo"]["version"], "0.1.0");
    }

    #[tokio::test]
    async fn test_notifications_initialized() {
        let registry = ToolRegistry::new();
        let raw = json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
            "params": {}
        })
        .to_string();

        let response = handle_mcp_message(&registry, &raw).await;
        assert!(response.is_none());
    }

    #[tokio::test]
    async fn test_tools_list() {
        let mut registry = ToolRegistry::new();
        registry.register(Arc::new(DummyTool));

        let raw = json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {}
        })
        .to_string();

        let response = handle_mcp_message(&registry, &raw).await;
        assert!(response.is_some());
        let res: serde_json::Value = serde_json::from_str(&response.unwrap()).unwrap();
        assert_eq!(res["jsonrpc"], "2.0");
        assert_eq!(res["id"], 2);

        let tools = res["result"]["tools"].as_array().expect("tools array");
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["name"], "dummy_tool");
        assert_eq!(tools[0]["description"], "A dummy tool for testing");
        assert_eq!(tools[0]["inputSchema"]["type"], "object");
        assert_eq!(
            tools[0]["inputSchema"]["properties"]["foo"]["type"],
            "string"
        );
    }

    #[tokio::test]
    async fn test_tools_call_unknown_tool() {
        let registry = ToolRegistry::new();
        let raw = json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "unknown_tool",
                "arguments": {}
            }
        })
        .to_string();

        let response = handle_mcp_message(&registry, &raw).await;
        assert!(response.is_some());
        let res: serde_json::Value = serde_json::from_str(&response.unwrap()).unwrap();
        assert_eq!(res["jsonrpc"], "2.0");
        assert_eq!(res["id"], 3);
        assert_eq!(res["error"]["code"], -32601);
        assert_eq!(res["error"]["message"], "Method not found");
    }

    #[tokio::test]
    async fn test_tools_call_known_tool() {
        let mut registry = ToolRegistry::new();
        registry.register(Arc::new(DummyTool));

        let raw = json!({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": {
                "name": "dummy_tool",
                "arguments": {
                    "foo": "bar"
                }
            }
        })
        .to_string();

        let response = handle_mcp_message(&registry, &raw).await;
        assert!(response.is_some());
        let res: serde_json::Value = serde_json::from_str(&response.unwrap()).unwrap();
        assert_eq!(res["jsonrpc"], "2.0");
        assert_eq!(res["id"], 4);
        assert!(res["error"].is_null());

        let content = res["result"]["content"].as_array().expect("content array");
        assert_eq!(content.len(), 1);
        assert_eq!(content[0]["type"], "text");
        assert_eq!(content[0]["text"], "called with bar");
    }

    #[tokio::test]
    async fn test_tools_call_error_execution() {
        let mut registry = ToolRegistry::new();
        registry.register(Arc::new(FailingTool));

        let raw = json!({
            "jsonrpc": "2.0",
            "id": 5,
            "method": "tools/call",
            "params": {
                "name": "failing_tool",
                "arguments": {}
            }
        })
        .to_string();

        let response = handle_mcp_message(&registry, &raw).await;
        assert!(response.is_some());
        let res: serde_json::Value = serde_json::from_str(&response.unwrap()).unwrap();
        assert_eq!(res["jsonrpc"], "2.0");
        assert_eq!(res["id"], 5);
        assert_eq!(res["result"]["isError"], true);
        let content = res["result"]["content"].as_array().expect("content array");
        assert_eq!(content[0]["text"], "something went wrong");
    }

    #[tokio::test]
    async fn test_unknown_method() {
        let registry = ToolRegistry::new();
        let raw = json!({
            "jsonrpc": "2.0",
            "id": 6,
            "method": "non_existent_method",
            "params": {}
        })
        .to_string();

        let response = handle_mcp_message(&registry, &raw).await;
        assert!(response.is_some());
        let res: serde_json::Value = serde_json::from_str(&response.unwrap()).unwrap();
        assert_eq!(res["id"], 6);
        assert_eq!(res["error"]["code"], -32601);
    }
}
