!(function (t, e) {
	var o, n, p, r;
	e.__SV ||
		((window.posthog = e),
		(e._i = []),
		(e.init = function (i, s, a) {
			function g(t, e) {
				var o = e.split('.');
				2 == o.length && ((t = t[o[0]]), (e = o[1])),
					(t[e] = function () {
						t.push([e].concat(Array.prototype.slice.call(arguments, 0)));
					});
			}
			((p = t.createElement('script')).type = 'text/javascript'),
				(p.async = !0),
				(p.src = s.api_host + '/static/array.js'),
				(r = t.getElementsByTagName('script')[0]).parentNode.insertBefore(p, r);
			var u = e;
			for (
				void 0 !== a ? (u = e[a] = []) : (a = 'posthog'),
					u.people = u.people || [],
					u.toString = function (t) {
						var e = 'posthog';
						return 'posthog' !== a && (e += '.' + a), t || (e += ' (stub)'), e;
					},
					u.people.toString = function () {
						return u.toString(1) + '.people (stub)';
					},
					o =
						'capture identify alias group people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled getFeatureFlag onFeatureFlags reloadFeatureFlags'.split(
							' ',
						),
					n = 0;
				n < o.length;
				n++
			)
				g(u, o[n]);
			e._i.push([i, s, a]);
		}),
		(e.__SV = 1));
})(document, window.posthog || []);

// MarcFlow - Tradutor Dinâmico PT-BR para Nós e Campos do n8n
(function () {
	const EXACT_TEXT_MAP = {
		// Common Node Titles & Subtitles
		"Webhook": "Webhook (Gatilho HTTP)",
		"HTTP Request": "Requisição HTTP",
		"Respond to Webhook": "Responder ao Webhook",
		"Code": "Código (JS / Python)",
		"Edit Fields (Set)": "Editar Campos (Set)",
		"Edit Fields": "Editar Campos (Set)",
		"Schedule Trigger": "Gatilho de Agendamento",
		"Manual Trigger": "Gatilho Manual",
		"When clicking ‘Execute workflow’": "Ao clicar em ‘Executar fluxo’",
		"When Executed by Another Workflow": "Quando Executado por Outro Fluxo",
		"Execute Sub-workflow": "Executar Subfluxo",
		"If": "Condição (Se / If)",
		"Switch": "Múltipla Escolha (Switch)",
		"Merge": "Mesclar Dados (Merge)",
		"Split Out": "Separar Itens (Split Out)",
		"Aggregate": "Agregar Itens",
		"Limit": "Limitar Itens",
		"Remove Duplicates": "Remover Duplicados",
		"Sort": "Ordenar Itens",
		"Loop Over Items (Split in Batches)": "Loop sobre Itens (Lotes)",
		"Wait": "Aguardar (Wait)",
		"No Operation, do nothing": "Sem Operação (Fazer nada)",
		"Sticky Note": "Nota Adesiva",
		"Filter": "Filtrar Itens",

		// Common Node Parameter Labels
		"Authentication": "Autenticação",
		"HTTP Method": "Método HTTP",
		"Method": "Método",
		"Path": "Caminho (Path)",
		"URL": "URL",
		"Response Mode": "Modo de Resposta",
		"Response Code": "Código de Resposta",
		"Response Data": "Dados de Resposta",
		"Respond With": "Responder Com",
		"Response Body": "Corpo da Resposta (Body)",
		"Send Query Parameters": "Enviar Parâmetros de Consulta (Query)",
		"Query Parameters": "Parâmetros de Consulta (Query)",
		"Send Headers": "Enviar Cabeçalhos (Headers)",
		"Header Parameters": "Parâmetros de Cabeçalho (Headers)",
		"Send Body": "Enviar Corpo (Body)",
		"Body Content Type": "Tipo de Conteúdo do Corpo",
		"Specify Body": "Especificar Corpo",
		"Options": "Opções",
		"Add Option": "Adicionar Opção",
		"No properties": "Nenhuma propriedade adicionada",
		"Language": "Linguagem",
		"Mode": "Modo de Execução",
		"Run Once for All Items": "Executar Uma Vez para Todos os Itens",
		"Run Once for Each Item": "Executar Uma Vez para Cada Item",
		"JavaScript": "JavaScript",
		"Python (Beta)": "Python (Beta)",
		"Conditions": "Condições",
		"Convert types where required": "Converter tipos automaticamente se necessário",
		"Include Other Input Fields": "Incluir Outros Campos de Entrada",
		"Fields to Set": "Campos para Definir",
		"Add Field": "Adicionar Campo",
		"Drag input fields here": "Arraste campos de entrada para cá",
		"or": "ou",
		"None": "Nenhuma",
		"Predefined Credential Type": "Credencial Pré-definida (Integração)",
		"Generic Credential Type": "Credencial Genérica (Token/Header/Basic)",
		"When Last Node Finishes": "Quando o Último Nó Terminar",
		"Immediately": "Imediatamente",
		"Using 'Respond to Webhook' Node": "Usando o Nó 'Responder ao Webhook'",
		"All Incoming Items": "Todos os Itens Recebidos",
		"First Incoming Item": "Primeiro Item Recebido",
		"No Data": "Sem Dados"
	};

	function translateTextNodes(root) {
		if (!root) return;
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
		let node;
		while ((node = walker.nextNode())) {
			const parentTag = node.parentElement && node.parentElement.tagName;
			if (parentTag === 'SCRIPT' || parentTag === 'STYLE' || parentTag === 'CODE' || parentTag === 'PRE' || parentTag === 'TEXTAREA') {
				continue;
			}
			const val = node.nodeValue;
			if (!val) continue;
			const trimmed = val.trim();
			if (trimmed && EXACT_TEXT_MAP[trimmed]) {
				node.nodeValue = val.replace(trimmed, EXACT_TEXT_MAP[trimmed]);
			}
		}
	}

	if (typeof window !== 'undefined' && typeof MutationObserver !== 'undefined') {
		let scheduled = false;
		const observer = new MutationObserver(() => {
			if (scheduled) return;
			scheduled = true;
			requestAnimationFrame(() => {
				scheduled = false;
				translateTextNodes(document.body);
			});
		});

		const init = () => {
			document.documentElement.setAttribute('lang', 'pt-BR');
			document.title = 'n8n - Automação de Fluxos (Português)';
			if (document.body) {
				translateTextNodes(document.body);
				observer.observe(document.body, {
					childList: true,
					subtree: true
				});
			}
		};

		if (document.readyState === 'loading') {
			window.addEventListener('DOMContentLoaded', init);
		} else {
			init();
		}
	}
})();
