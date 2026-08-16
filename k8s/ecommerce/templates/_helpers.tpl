{{/*
Standard labels for a service. Call with a dict:
  {{- include "ecommerce.labels" (dict "name" "auth-service" "root" $) | nindent 4 }}
*/}}
{{- define "ecommerce.labels" -}}
app: {{ .name }}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
{{- end }}

{{/*
Full image reference for a service entry, e.g.
  asia-south1-docker.pkg.dev/distance-493706/auth/auth-service:latest
*/}}
{{- define "ecommerce.image" -}}
{{- printf "%s/%s:%s" .root.Values.global.registry .svc.repo (.root.Values.global.tag | toString) -}}
{{- end }}

{{/*
imagePullSecrets block, rendered only when the list is non-empty.
*/}}
{{- define "ecommerce.pullSecrets" -}}
{{- with .Values.global.imagePullSecrets }}
imagePullSecrets:
{{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}
