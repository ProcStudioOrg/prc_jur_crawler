import json
import os
import re

def process_file(json_path, title, output_md_path, filter_terms=None):
    if not os.path.exists(json_path):
        print(f"File not found: {json_path}")
        return
    
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    md_content = f"# {title}\n\n"
    count = 0
    
    for item in data:
        ementa = item.get('ementa', '')
        
        # Filtro semântico simples se existirem termos desejados e mandatórios
        if filter_terms:
            text_to_search = ementa.lower()
            match = any(term in text_to_search for term in filter_terms)
            if not match:
                continue

        # Evitar textos vazios caso dê match errado e sanitizar ementa
        if not ementa.strip():
            continue

        numero = item.get('numeroProcesso', 'Sem Número')
        julgador = item.get('relator', 'Não informado') 
        orgao = item.get('orgaoJulgador', 'Não informado')
        data_decisao = item.get('dataDecisao', 'Não informado')

        # Regex TJPR para os casos onde buscaríamos lá; no TRF4 a priori já traz, mas não custa.
        if numero == 'Sem Número' or not numero:
             match_num = re.search(r"(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}|\d{4,}-\d{2}\.\d{4})", ementa)
             if match_num:
                 numero = match_num.group(1)

        md_content += f"## Processo: {numero}\n"
        md_content += f"- **Órgão Julgador:** {orgao}\n"
        md_content += f"- **Relator(a):** {julgador}\n"
        md_content += f"- **Data Decisão:** {data_decisao}\n\n"
        md_content += f"**Ementa:**\n> {ementa}\n\n"
        md_content += "---\n\n"
        
        count += 1
        if count >= 10: # Limitando aos top 10 mais relevantes do json
            break

    with open(output_md_path, 'w', encoding='utf-8') as f:
        f.write(md_content)
    
    print(f"Salvo {output_md_path} com {count} acórdãos filtrados.")

# Processando Tema 1: UTFPR
process_file(
    '/home/brpl/code/crawlers/jur/relatorios/resultado_utfpr.json',
    'Jurisprudência - UTFPR (Legitimidade Passiva e Revisão de Aposentadoria)',
    '/home/brpl/code/crawlers/jur/relatorios/relatorio_utfpr.md',
    filter_terms=['legitimi', 'utfpr']
)

# Processando Tema 2: Concausa
process_file(
    '/home/brpl/code/crawlers/jur/relatorios/resultado_concausa.json',
    'Jurisprudência - Aposentadoria por Incapacidade (Concausa e Integralidade)',
    '/home/brpl/code/crawlers/jur/relatorios/relatorio_concausa.md',
    filter_terms=['concausa', 'integral', '100%']
)
