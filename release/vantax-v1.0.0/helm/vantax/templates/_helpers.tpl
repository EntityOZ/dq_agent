{{/*
Common name for the chart.
*/}}
{{- define "vantax.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified app name.
*/}}
{{- define "vantax.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "vantax.labels" -}}
helm.sh/chart: {{ include "vantax.name" . }}-{{ .Chart.Version }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{ include "vantax.selectorLabels" . }}
{{- end }}

{{/*
Selector labels.
*/}}
{{- define "vantax.selectorLabels" -}}
app.kubernetes.io/name: {{ include "vantax.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
